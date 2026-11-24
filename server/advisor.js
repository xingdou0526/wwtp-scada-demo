// 曝气 AI 辅助决策规则引擎：只输出建议，执行必须人工触发
import { randomUUID } from "node:crypto";
import { KNOWLEDGE_REFS as KB } from "./management-defaults.js";

let adviceSeq = 0;
const MAX_NOTE_LENGTH = 1000;

function executedRecord(advice, operation) {
  return {
    ...advice,
    status: "executed",
    executedTick: operation.executeTick,
    endedAt: operation.executeTime,
    endedTick: operation.executeTick,
    endedClockMinutes: operation.before?.clockMinutes ?? null,
    operationId: operation.id,
  };
}

function adviceRank(advice) {
  if (advice.kind === "inspect-sensor") return 0;
  if (advice.kind === "inspect-airflow") return 1;
  if (advice.kind === "inspect-cap") return 2;
  if (advice.type === "adjust" && !advice.blocked) return 3;
  if (advice.priority === "high") return 4;
  if (advice.type === "adjust") return 5;
  return 6;
}

export function createAdvisor(sim, {
  initialOperations = [], saveOperations = () => {},
  initialAdvices = [], saveAdvices = () => {},
} = {}) {
  const advices = [];
  let operations = initialOperations;
  let loadRising = false;
  let sessionId = randomUUID();
  const rulesAtIssue = new WeakMap();
  for (const id of [...operations.map(({ adviceId }) => adviceId), ...initialAdvices.map(({ id }) => id)]) {
    const sequence = /^ADV-(\d+)$/.exec(id);
    if (sequence) adviceSeq = Math.max(adviceSeq, Number(sequence[1]));
  }

  const operationsByAdvice = new Map(operations.map((operation) => [operation.adviceId, operation]));
  const restartedAt = new Date().toISOString();
  let records = initialAdvices.map((advice) => {
    if (advice.status !== "pending") return advice;
    const operation = operationsByAdvice.get(advice.id);
    return operation ? executedRecord(advice, operation) : {
      ...advice, status: "interrupted", endReason: "restart", endedAt: restartedAt,
      endedTick: null, endedClockMinutes: null,
    };
  });
  if (records.some((record, index) => record !== initialAdvices[index])) saveAdvices(records);

  function commitOperations(next) {
    saveOperations(next);
    operations = next;
  }

  function commitAdvices(next) {
    saveAdvices(next);
    records = next;
  }

  function endedAdvice(advice, status, endReason, details = {}) {
    return {
      ...advice, status, endReason,
      endedAt: new Date().toISOString(),
      endedTick: sim.state.tick,
      endedClockMinutes: sim.state.clockMinutes,
      ...details,
    };
  }

  function finishAdvices(pending, status, reason, details) {
    if (!pending.length) return;
    const updates = new Map(pending.map((advice) => [advice.id, endedAdvice(advice, status, reason, details)]));
    commitAdvices(records.map((advice) => updates.get(advice.id) ?? advice));
    for (const advice of pending) Object.assign(advice, updates.get(advice.id));
  }

  function addAdvice(a, replaces) {
    adviceSeq += 1;
    const advice = {
      id: `ADV-${String(adviceSeq).padStart(3, "0")}`,
      sessionId,
      createdAt: new Date().toISOString(),
      createdTick: sim.state.tick,
      createdClockMinutes: sim.state.clockMinutes,
      status: "pending",
      ...a,
    };
    const previous = replaces && endedAdvice(replaces, "superseded", "upgraded", { supersededBy: advice.id });
    commitAdvices([advice, ...records.map((record) => record.id === previous?.id ? previous : record)]);
    if (previous) Object.assign(replaces, previous);
    rulesAtIssue.set(advice, sim.LIMITS);
    advices.unshift(advice);
    if (advices.length > 50) {
      const oldestResolved = advices.findLastIndex(({ status }) => status !== "pending");
      if (oldestResolved >= 0) advices.splice(oldestResolved, 1);
    }
    return advice;
  }

  function pendingAdvices() {
    return advices.filter(({ status }) => status === "pending");
  }

  function invalidatePending(reason = "limits") {
    finishAdvices(pendingAdvices(), "invalidated", reason, { invalidatedBy: reason });
  }

  function resetSession() {
    finishAdvices(pendingAdvices(), "interrupted", "reset");
    interruptReviews("reset");
    sessionId = randomUUID();
    advices.length = 0;
    loadRising = false;
  }

  function adviceHistory() {
    const archivedIds = new Set(records.map(({ id }) => id));
    const legacy = operations.filter(({ adviceId }) => typeof adviceId === "string" && !archivedIds.has(adviceId)).map((operation) => executedRecord({
      id: operation.adviceId,
      sessionId: null,
      createdAt: null,
      createdTick: null,
      createdClockMinutes: null,
      expiresAtTick: null,
      title: operation.title,
      type: "adjust",
      priority: null,
      action: operation.action,
      knowledgeRef: operation.knowledgeRef,
      reasons: operation.during?.reasons ?? [],
      forecast: operation.during?.forecast ?? {},
      constraints: [],
      risks: [],
    }, operation));
    return [...records.filter(({ status }) => status !== "pending"), ...legacy]
      .sort((a, b) => (b.createdAt ?? b.endedAt ?? "").localeCompare(a.createdAt ?? a.endedAt ?? ""));
  }

  function executionRestriction() {
    const { tick, lastExecuteTick } = sim.state;
    if (lastExecuteTick >= 0 && tick - lastExecuteTick < sim.LIMITS.minExecuteInterval) {
      return "距上次调节间隔不足";
    }
    if (operations.some((op) => operationReviewStatus(op) === "pending" && op.reviewDueTick > tick)) {
      return "上次调节尚未到复评时间";
    }
    return "";
  }

  function adjustmentRestriction(action) {
    const { measured, fault, bio, effluent, influent, scenario } = sim.state;
    const limits = sim.LIMITS;
    if (fault.airflowFeedback || measured.airflowQuality !== "good") return "风量反馈不可信，请先排查仪表";
    if (fault.doDrift || fault.doStuck || fault.doOffline || measured.doQuality !== "good") return "DO 测量数据不可信，请先排查仪表";
    if (action.from !== bio.doSetpoint) return "当前 DO 目标值已变化，请查看新建议";
    if (action.to > action.from && bio.airflow > limits.airflowMax * 0.95) return "风量已接近上限，请先核查供氧能力";
    if (action.to < action.from && (scenario.shock || scenario.storm || loadRising ||
      !(scenario.night || influent.flow < 700) || effluent.nh4 >= Math.min(0.5, limits.nh4InternalLimit))) {
      return "当前负荷或出水氨氮已超出节能调节条件";
    }
    return "";
  }

  // 滑动窗口统计
  function windowStats(history, key, len) {
    const vals = history.slice(-len).map((h) => h[key]).filter((v) => v !== null && v !== undefined);
    if (!vals.length) return null;
    return {
      avg: vals.reduce((a, b) => a + b, 0) / vals.length,
      first: vals[0],
      last: vals[vals.length - 1],
    };
  }

  function evaluate(history, measuredHistory) {
    const s = sim.state;
    const limits = sim.LIMITS;
    const flowWin = windowStats(history, "flow", 60);
    const nh4Win = windowStats(history, "infNh4", 60);
    const flowRising = flowWin && flowWin.last > flowWin.first * 1.15;
    const nh4Rising = nh4Win && nh4Win.last > nh4Win.first * 1.2;
    loadRising = Boolean(flowRising || nh4Rising);
    const doVal = s.measured.do;
    const quality = s.measured.doQuality;
    const sensorIssue = doVal === null || quality !== "good" || s.fault.doDrift || s.fault.doStuck || s.fault.doOffline;
    const airflowIssue = s.fault.airflowFeedback || s.measured.airflowQuality !== "good";
    const doWin = windowStats(measuredHistory, "do", 10);
    const doHighWin = windowStats(measuredHistory, "do", 15);
    const lowDo = doWin && doWin.avg < s.bio.doSetpoint - 0.35;
    const highDo = doHighWin && doHighWin.avg > s.bio.doSetpoint + 0.7;
    const nearAirflowCap = s.bio.airflow > limits.airflowMax * 0.95;
    const overNh4Limit = s.effluent.nh4 > limits.nh4InternalLimit;
    const normalDo = !sensorIssue && !lowDo && Math.abs(doVal - s.bio.doSetpoint) < 0.4;

    finishAdvices(pendingAdvices().filter((a) => a.expiresAtTick <= s.tick), "expired", "timeout");
    finishAdvices(pendingAdvices().filter((a) => rulesAtIssue.get(a) !== limits), "invalidated", "limits", { invalidatedBy: "limits" });
    const changed = pendingAdvices().filter((advice) => {
      if (advice.action) {
        return adjustmentRestriction(advice.action) ||
          (advice.kind === "raise" && doWin && !lowDo) ||
          (advice.kind === "lower" && doHighWin && !highDo);
      }
      if (advice.kind === "inspect-sensor") return !sensorIssue;
      if (advice.kind === "inspect-airflow") return !airflowIssue;
      if (advice.kind === "inspect-cap") return sensorIssue || airflowIssue || !nearAirflowCap || !lowDo;
      if (advice.kind === "observe") return sensorIssue || airflowIssue || !loadRising;
      return advice.kind === "inspect-nh4" && (!overNh4Limit || (advice.assumesNormalDo && !normalDo));
    });
    finishAdvices(changed, "invalidated", "conditions", { invalidatedBy: "conditions" });

    // 同类建议冷却期，避免过期/忽略后反复刷屏
    function cooledDown(kind, ticks) {
      const last = advices.find((a) => a.kind === kind && !a.invalidatedBy);
      return !last || (last.status !== "pending" && s.tick - last.createdTick >= ticks);
    }

    // 出水超内控可与独立的调节和仪表排查并存。
    if (overNh4Limit && cooledDown("inspect-nh4", 60)) {
      addAdvice({
        kind: "inspect-nh4",
        type: "inspect",
        priority: "high",
        title: normalDo ? "出水氨氮超内控，但 DO 正常：建议排查非曝气因素" : "出水氨氮超内控：建议核查出水数据与进水负荷",
        action: null,
        assumesNormalDo: normalDo,
        reasons: [
          { label: "出水氨氮", value: `${s.effluent.nh4.toFixed(2)} mg/L，超内控 ${limits.nh4InternalLimit} mg/L` },
          ...(normalDo ? [{ label: "好氧区 DO", value: `${doVal.toFixed(2)} mg/L，处于目标范围内` }] : []),
          { label: "水温", value: `${s.influent.temp.toFixed(0)} ℃${s.influent.temp < 15 ? "，低温抑制硝化活性" : ""}` },
        ],
        dataQuality: quality,
        constraints: [normalDo ? "DO 正常时不盲目加曝气，避免无效能耗" : "结合可靠的好氧区测量数据评估曝气需求"],
        forecast: {
          note: normalDo
            ? "建议核查水温、MLSS、污泥龄及进水毒性冲击；低温工况可通过提高 MLSS 或延长泥龄改善硝化"
            : "建议核查出水检测与进水负荷，结合生化运行数据复判",
        },
        risks: normalDo ? ["仅提高曝气对此类氨氮升高改善有限"] : [],
        knowledgeRef: KB.nitrification,
        expiresAtTick: s.tick + 60,
        reviewAfterTick: s.tick + 60,
      });
    }

    const restriction = executionRestriction();

    // R0：测量不可信时排查仪表，并拦截曝气调节。
    if (sensorIssue && cooledDown("inspect-sensor", 30)) {
      addAdvice({
        kind: "inspect-sensor",
        type: "inspect",
        priority: "high",
        title: quality === "bad" ? "DO 仪表数据不可用，建议现场排查" : "DO 仪表数据不可信，建议现场核查",
        action: null,
        reasons: [
          { label: "DO 数据质量", value: quality === "bad" ? `异常（${s.measured.doFaultType === "stuck" ? "数值卡死" : "数据中断"}）` : "测量值可疑，需核查探头与读数" },
          { label: "当前风量", value: `${s.bio.airflow.toFixed(0)} m³/h，保持现有联动运行` },
        ],
        dataQuality: s.measured.doQuality,
        constraints: ["数据不可信期间禁止输出曝气调节建议"],
        forecast: { note: "恢复可靠测量前，建议维持当前 DO 目标值，依托现场自动联动运行" },
        risks: ["盲目依据异常数据调节可能导致过曝气或供氧不足"],
        knowledgeRef: KB.sensor,
        expiresAtTick: s.tick + 60,
        reviewAfterTick: s.tick + 30,
      });
    }

    if (airflowIssue && cooledDown("inspect-airflow", 30)) {
      addAdvice({
        kind: "inspect-airflow",
        type: "inspect",
        priority: "high",
        title: "风量反馈异常，建议先核查仪表与联动信号",
        action: null,
        reasons: [
          { label: "反馈风量", value: `${s.measured.airflow.toFixed(0)} m³/h，数据质量异常` },
        ],
        dataQuality: "bad",
        constraints: ["风量数据不可信期间暂停曝气调节建议"],
        forecast: { note: "核实反馈信号后重新评估当前供氧状态" },
        risks: [],
        knowledgeRef: KB.sensor,
        expiresAtTick: s.tick + 60,
        reviewAfterTick: s.tick + 30,
      });
    }

    if (sensorIssue || airflowIssue || !doWin) return;
    const pendingDo = pendingAdvices();
    if (pendingDo.some((advice) => advice.action || advice.kind === "inspect-cap")) return;
    const observation = pendingDo.find((advice) => advice.kind === "observe");

    // R1：DO 持续低于目标 → 建议上调 DO 目标值
    if (lowDo) {
      if (nearAirflowCap) {
        if (!cooledDown("inspect-cap", 60)) return;
        addAdvice({
          kind: "inspect-cap",
          type: "inspect",
          priority: "high",
          title: "风量已接近上限，建议核查供氧能力",
          action: null,
          reasons: [
            { label: "好氧区 DO", value: `${doVal.toFixed(2)} mg/L（目标 ${s.bio.doSetpoint.toFixed(1)}）` },
            { label: "当前风量", value: `${s.bio.airflow.toFixed(0)} m³/h，已达上限 95% 以上` },
          ],
          dataQuality: quality,
          constraints: ["风量接近上限时不再上调 DO 目标"],
          forecast: { note: "继续上调目标无法有效提升 DO，需检查风机台数、曝气器堵塞或负荷分配" },
          risks: ["长期低 DO 可能导致硝化不足、出水氨氮升高"],
          knowledgeRef: KB.aeration,
          expiresAtTick: s.tick + 60,
          reviewAfterTick: s.tick + 30,
        }, observation);
        return;
      }
      if (!cooledDown("raise", 15)) return;
      const to = round1(Math.min(limits.doSetpointMax, s.bio.doSetpoint + limits.doSetpointStep));
      if (to === s.bio.doSetpoint) return;
      addAdvice({
        kind: "raise",
        type: "adjust",
        priority: "high",
        title: "建议提高曝气：上调好氧区 DO 目标值",
        action: { param: "doSetpoint", from: s.bio.doSetpoint, to },
        reasons: [
          { label: "好氧区 DO", value: `近 10 分钟均值 ${doWin.avg.toFixed(2)} mg/L，低于目标 ${s.bio.doSetpoint.toFixed(1)} mg/L` },
          { label: "进水负荷", value: `流量 ${s.influent.flow.toFixed(0)} m³/h，进水氨氮 ${s.influent.nh4.toFixed(1)} mg/L` },
          ...(observation ? [{ label: "此前负荷观察", value: observation.reasons[0].value }] : []),
          { label: "出水氨氮", value: `${s.effluent.nh4.toFixed(2)} mg/L（内控 ${limits.nh4InternalLimit} mg/L）` },
        ],
        dataQuality: quality,
        constraints: [
          restriction || "已满足最小调节间隔与复评约束",
          `调整后目标 ${to.toFixed(1)} mg/L，处于 ${limits.doSetpointMin}~${limits.doSetpointMax} 允许范围`,
          `单次步长 ${limits.doSetpointStep} mg/L，由现有联动系统自动增加风量`,
        ],
        blocked: Boolean(restriction),
        forecast: {
          doRange: `${(to - 0.2).toFixed(1)} ~ ${(to + 0.2).toFixed(1)} mg/L`,
          responseMinutes: "30~45 分钟逐步趋稳",
          nh4Trend: "有助于维持硝化能力，抑制出水氨氮上升风险",
          energyDeltaPct: "+6% ~ +12%（风机电耗，随实际风量变化）",
        },
        risks: ["曝气增加将带来电耗上升", "若 DO 持续不回升，需排查曝气器或风量反馈"],
        knowledgeRef: KB.aeration,
        expiresAtTick: s.tick + 15,
        reviewAfterTick: s.tick + limits.reviewAfter,
      }, observation);
      return;
    }

    // R2：DO 持续偏高且负荷较低 → 节能下调（冲击/负荷上升工况下禁止节能建议）
    const lowLoad = s.scenario.night || s.influent.flow < 700;
    if (
      highDo &&
      s.effluent.nh4 < Math.min(0.5, limits.nh4InternalLimit) && lowLoad &&
      s.bio.doSetpoint > limits.doSetpointMin &&
      !s.scenario.shock && !s.scenario.storm && !loadRising &&
      cooledDown("lower", 90)
    ) {
      const to = round1(Math.max(limits.doSetpointMin, s.bio.doSetpoint - limits.doSetpointStep));
      addAdvice({
        kind: "lower",
        type: "adjust",
        priority: "medium",
        title: "建议降低曝气：低负荷工况节能运行",
        action: { param: "doSetpoint", from: s.bio.doSetpoint, to },
        reasons: [
          { label: "好氧区 DO", value: `近 15 分钟均值 ${doHighWin.avg.toFixed(2)} mg/L，明显高于目标 ${s.bio.doSetpoint.toFixed(1)} mg/L` },
          { label: "负荷水平", value: `进水流量 ${s.influent.flow.toFixed(0)} m³/h，处于低负荷工况` },
          { label: "出水氨氮", value: `${s.effluent.nh4.toFixed(2)} mg/L，达标裕量充足` },
        ],
        dataQuality: quality,
        constraints: [
          restriction || "已满足最小调节间隔与复评约束",
          `调整后目标 ${to.toFixed(1)} mg/L，不低于下限 ${limits.doSetpointMin} mg/L`,
        ],
        blocked: Boolean(restriction),
        forecast: {
          doRange: `${(to - 0.2).toFixed(1)} ~ ${(to + 0.2).toFixed(1)} mg/L`,
          responseMinutes: "20~40 分钟逐步趋稳",
          nh4Trend: "预计出水氨氮维持当前水平，需执行后持续观察",
          energyDeltaPct: "-8% ~ -15%（风机电耗）",
        },
        risks: ["若负荷突然回升，需及时恢复 DO 目标", "下调后需关注出水氨氮变化"],
        knowledgeRef: KB.energy,
        expiresAtTick: s.tick + 15,
        reviewAfterTick: s.tick + limits.reviewAfter,
      });
      return;
    }

    // R3：进水负荷快速上升的前瞻提示（DO 尚未跌破时）
    if (loadRising && doVal > s.bio.doSetpoint - 0.35 && cooledDown("observe", 60)) {
      addAdvice({
        kind: "observe",
        type: "observe",
        priority: "low",
        title: "进水负荷上升，建议密切关注 DO 变化",
        action: null,
        reasons: [
          flowRising
            ? { label: "进水流量", value: `近 1 小时由 ${flowWin.first.toFixed(0)} 升至 ${flowWin.last.toFixed(0)} m³/h（+15% 以上）` }
            : { label: "进水氨氮", value: `近 1 小时由 ${nh4Win.first.toFixed(1)} 升至 ${nh4Win.last.toFixed(1)} mg/L（+20% 以上）` },
          { label: "当前 DO", value: `${doVal.toFixed(2)} mg/L，暂在目标范围内` },
        ],
        dataQuality: quality,
        constraints: ["DO 未跌破阈值前不提前调节，避免过曝气"],
        forecast: { note: "需氧量将随负荷上升，若 DO 持续回落将生成提高曝气建议" },
        risks: [],
        knowledgeRef: KB.aeration,
        expiresAtTick: s.tick + 30,
        reviewAfterTick: s.tick + 30,
      });
    }
  }

  function execute(id, operatorNote = "") {
    const limits = sim.LIMITS;
    const a = advices.find((x) => x.id === id);
    if (!a) return { ok: false, error: "建议不存在" };
    if (a.invalidatedBy === "limits" || (a.status === "pending" && rulesAtIssue.get(a) !== limits)) return { ok: false, error: "规则参数已更新，请查看新建议" };
    if (a.invalidatedBy === "conditions") return { ok: false, error: "工况或数据质量已变化，请查看新建议" };
    if (a.status !== "pending") return { ok: false, error: `建议状态为 ${a.status}，不可执行` };
    if (a.expiresAtTick <= sim.state.tick) {
      finishAdvices([a], "expired", "timeout");
      return { ok: false, error: "建议已过期" };
    }
    if (a.type !== "adjust" || !a.action) return { ok: false, error: "该建议为排查/观察类，无调节动作" };
    if (a.blocked) return { ok: false, error: executionRestriction() || "请等待可执行的新建议" };
    const safety = adjustmentRestriction(a.action);
    if (safety) return { ok: false, error: safety };

    // 执行前再次校验安全边界
    const { from, to } = a.action;
    if (to < limits.doSetpointMin || to > limits.doSetpointMax) {
      return { ok: false, error: "目标值超出允许范围，已拦截" };
    }
    if (Math.abs(to - from) > limits.doSetpointStep + 1e-9) {
      return { ok: false, error: "单次调整步长超限，已拦截" };
    }
    const restriction = executionRestriction();
    if (restriction) return { ok: false, error: restriction };
    if (!validNote(operatorNote)) return { ok: false, error: "人工备注限 1000 字以内" };

    reviewOperations();
    const before = sim.snapshot();
    const op = {
      id: `OP-${a.id}`,
      adviceId: a.id,
      title: a.title,
      action: { ...a.action },
      knowledgeRef: a.knowledgeRef,
      executeTick: sim.state.tick,
      executeTime: new Date().toISOString(),
      before,
      during: { ...a.action, reasons: a.reasons, forecast: a.forecast },
      after: null, // 复评时回填
      reviewDueTick: sim.state.tick + limits.reviewAfter,
      operatorNote: operatorNote.trim(),
      feedback: null,
    };
    commitOperations([op, ...operations]);
    sim.state.bio.doSetpoint = to;
    sim.state.lastExecuteTick = sim.state.tick;
    // 操作记录是执行结果的持久化来源，重启时按 adviceId 与原建议快照对齐。
    const completed = executedRecord(a, op);
    records = records.map((advice) => advice.id === id ? completed : advice);
    Object.assign(a, completed);
    return { ok: true, operation: op };
  }

  function ignore(id) {
    const a = advices.find((x) => x.id === id);
    if (!a || a.status !== "pending") return { ok: false, error: "建议不存在或已处理" };
    if (a.expiresAtTick <= sim.state.tick) {
      finishAdvices([a], "expired", "timeout");
      return { ok: false, error: "建议已过期" };
    }
    finishAdvices([a], "ignored", "operator");
    return { ok: true };
  }

  function updateFeedback(id, changes) {
    const index = operations.findIndex((op) => op.id === id);
    if (index === -1) return { ok: false, status: 404, error: "操作记录不存在" };
    if (!changes || !["operatorNote", "evaluation", "effective"].some((field) => Object.hasOwn(changes, field))) {
      return { ok: false, status: 400, error: "请提供人工备注、效果评价或建议是否有效" };
    }
    const previous = operations[index];
    const {
      operatorNote = previous.operatorNote ?? "",
      evaluation = previous.feedback?.evaluation ?? "",
      effective = previous.feedback?.effective ?? null,
    } = changes;
    if (!validNote(operatorNote) || !validNote(evaluation) || (effective !== null && typeof effective !== "boolean")) {
      return { ok: false, status: 400, error: "人工备注和效果评价限 1000 字以内，有效性须为是、否或未判断" };
    }
    const note = operatorNote.trim();
    const evaluationText = evaluation.trim();
    const feedback = evaluationText || effective !== null
      ? { evaluation: evaluationText, effective, updatedAt: new Date().toISOString() }
      : null;
    const operation = { ...previous, operatorNote: note, feedback };
    const next = operations.slice();
    next[index] = operation;
    commitOperations(next);
    return { ok: true, operation };
  }

  function reviewOperations() {
    const isDue = (op) => operationReviewStatus(op) === "pending" && op.reviewDueTick <= sim.state.tick;
    if (!operations.some(isDue)) return;
    const after = sim.snapshot();
    commitOperations(operations.map((op) => isDue(op) ? { ...op, after } : op));
  }

  function interruptReviews(reason) {
    const isPending = (op) => operationReviewStatus(op) === "pending";
    if (!operations.some(isPending)) return;
    commitOperations(operations.map((op) => isPending(op) ? { ...op, reviewInterrupted: reason } : op));
  }

  return {
    advices,
    get activeAdvices() {
      return pendingAdvices().filter((a) => a.expiresAtTick > sim.state.tick && rulesAtIssue.get(a) === sim.LIMITS)
        .filter((a) => !a.action || !adjustmentRestriction(a.action))
        .sort((a, b) => adviceRank(a) - adviceRank(b));
    },
    get adviceHistory() { return adviceHistory(); },
    get operations() { return operations; },
    evaluate,
    invalidatePending,
    resetSession,
    execute,
    ignore,
    updateFeedback,
    reviewOperations,
    interruptReviews,
  };
}

export function operationReviewStatus(op) {
  if (op.after) return "reviewed";
  return op.reviewInterrupted ? "interrupted" : "pending";
}

function validNote(value) {
  return typeof value === "string" && value.length <= MAX_NOTE_LENGTH;
}

function round1(v) {
  return Math.round(v * 10) / 10;
}
