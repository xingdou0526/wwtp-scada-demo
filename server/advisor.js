// 曝气 AI 辅助决策规则引擎：只输出建议，执行必须人工触发
import { LIMITS } from "./simulator.js";

let adviceSeq = 0;
const MAX_NOTE_LENGTH = 1000;

// 知识库引用（第 6 步后台知识库的条目编号）
const KB = {
  aeration: "KB-AER-001",
  sensor: "KB-AER-002",
  energy: "KB-AER-003",
  nitrification: "KB-AER-004",
};

export function createAdvisor(sim, { initialOperations = [], saveOperations = () => {} } = {}) {
  const advices = [];
  let operations = initialOperations;
  for (const { adviceId } of operations) {
    const sequence = /^ADV-(\d+)$/.exec(adviceId);
    if (sequence) adviceSeq = Math.max(adviceSeq, Number(sequence[1]));
  }

  function commitOperations(next) {
    saveOperations(next);
    operations = next;
  }

  function addAdvice(a) {
    adviceSeq += 1;
    const advice = {
      id: `ADV-${String(adviceSeq).padStart(3, "0")}`,
      createdTick: sim.state.tick,
      status: "pending",
      ...a,
    };
    advices.unshift(advice);
    if (advices.length > 50) advices.pop();
    return advice;
  }

  function activeAdvice() {
    return advices.find((a) => a.status === "pending");
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
    // 过期处理
    for (const a of advices) {
      if (a.status === "pending" && a.expiresAtTick <= s.tick) a.status = "expired";
    }
    // 已有待处理建议时不重复生成
    if (activeAdvice()) return;

    // 同类建议冷却期，避免过期/忽略后反复刷屏
    function cooledDown(kind, ticks) {
      const last = advices.find((a) => a.kind === kind);
      return !last || s.tick - last.createdTick >= ticks;
    }

    const doVal = s.measured.do;
    const quality = s.measured.doQuality;
    const canExecute = s.tick - s.lastExecuteTick >= LIMITS.minExecuteInterval;
    const flowWinEarly = windowStats(history, "flow", 60);
    const nh4WinEarly = windowStats(history, "infNh4", 60);
    const flowRisingEarly = flowWinEarly && flowWinEarly.last > flowWinEarly.first * 1.15;
    const nh4RisingEarly = nh4WinEarly && nh4WinEarly.last > nh4WinEarly.first * 1.2;

    // R0：数据不可用 → 仅建议排查仪表，禁止调节
    if (quality === "bad" && cooledDown("inspect-sensor", 30)) {
      addAdvice({
        kind: "inspect-sensor",
        type: "inspect",
        priority: "high",
        title: "DO 仪表数据不可用，建议现场排查",
        action: null,
        reasons: [
          { label: "DO 数据质量", value: `异常（${s.measured.doFaultType === "stuck" ? "数值卡死" : "数据中断"}）` },
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
      return;
    }

    const doWin = windowStats(measuredHistory, "do", 10);
    const flowWin = windowStats(history, "flow", 60);
    const nh4Win = windowStats(history, "infNh4", 60);
    if (!doWin || doVal === null) return;

    const nearAirflowCap = s.bio.airflow > LIMITS.airflowMax * 0.95;

    // R1：DO 持续低于目标 → 建议上调 DO 目标值
    if (doWin.avg < s.bio.doSetpoint - 0.35) {
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
        });
        return;
      }
      if (quality === "suspect") return; // 数据可疑时不出调节建议
      if (!cooledDown("raise", 15)) return;
      const to = round1(Math.min(LIMITS.doSetpointMax, s.bio.doSetpoint + LIMITS.doSetpointStep));
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
          { label: "出水氨氮", value: `${s.effluent.nh4.toFixed(2)} mg/L（内控 ${LIMITS.nh4InternalLimit} mg/L）` },
        ],
        dataQuality: quality,
        constraints: [
          canExecute ? "距上次调节满足最小间隔" : "间隔约束未满足",
          `调整后目标 ${to.toFixed(1)} mg/L，处于 ${LIMITS.doSetpointMin}~${LIMITS.doSetpointMax} 允许范围`,
          `单次步长 ${LIMITS.doSetpointStep} mg/L，由现有联动系统自动增加风量`,
        ],
        blocked: !canExecute,
        forecast: {
          doRange: `${(to - 0.2).toFixed(1)} ~ ${(to + 0.2).toFixed(1)} mg/L`,
          responseMinutes: "30~45 分钟逐步趋稳",
          nh4Trend: "有助于维持硝化能力，抑制出水氨氮上升风险",
          energyDeltaPct: "+6% ~ +12%（风机电耗，随实际风量变化）",
        },
        risks: ["曝气增加将带来电耗上升", "若 DO 持续不回升，需排查曝气器或风量反馈"],
        knowledgeRef: KB.aeration,
        expiresAtTick: s.tick + 15,
        reviewAfterTick: s.tick + LIMITS.reviewAfter,
      });
      return;
    }

    // R2：DO 持续偏高且负荷较低 → 节能下调（冲击/负荷上升工况下禁止节能建议）
    const lowLoad = s.scenario.night || s.influent.flow < 700;
    const doHighWin = windowStats(measuredHistory, "do", 15);
    if (
      doHighWin && doHighWin.avg > s.bio.doSetpoint + 0.7 &&
      s.effluent.nh4 < 0.5 && lowLoad && quality === "good" &&
      s.bio.doSetpoint > LIMITS.doSetpointMin &&
      !s.scenario.shock && !s.scenario.storm && !nh4RisingEarly && !flowRisingEarly &&
      cooledDown("lower", 90)
    ) {
      const to = round1(Math.max(LIMITS.doSetpointMin, s.bio.doSetpoint - LIMITS.doSetpointStep));
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
          canExecute ? "距上次调节满足最小间隔" : "间隔约束未满足",
          `调整后目标 ${to.toFixed(1)} mg/L，不低于下限 ${LIMITS.doSetpointMin} mg/L`,
        ],
        blocked: !canExecute,
        forecast: {
          doRange: `${(to - 0.2).toFixed(1)} ~ ${(to + 0.2).toFixed(1)} mg/L`,
          responseMinutes: "20~40 分钟逐步趋稳",
          nh4Trend: "预计出水氨氮维持当前水平，需执行后持续观察",
          energyDeltaPct: "-8% ~ -15%（风机电耗）",
        },
        risks: ["若负荷突然回升，需及时恢复 DO 目标", "下调后需关注出水氨氮变化"],
        knowledgeRef: KB.energy,
        expiresAtTick: s.tick + 15,
        reviewAfterTick: s.tick + LIMITS.reviewAfter,
      });
      return;
    }

    // R3：进水负荷快速上升的前瞻提示（DO 尚未跌破时）
    const flowRising = flowWin && flowWin.last > flowWin.first * 1.15;
    const nh4Rising = nh4Win && nh4Win.last > nh4Win.first * 1.2;
    if ((flowRising || nh4Rising) && quality === "good" && doVal > s.bio.doSetpoint - 0.35 && cooledDown("observe", 60)) {
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
      return;
    }

    // R4：DO 正常但出水氨氮超标 → 非曝气因素排查
    if (
      s.effluent.nh4 > LIMITS.nh4InternalLimit &&
      Math.abs(doVal - s.bio.doSetpoint) < 0.4 && quality === "good" &&
      cooledDown("inspect-nh4", 60)
    ) {
      addAdvice({
        kind: "inspect-nh4",
        type: "inspect",
        priority: "high",
        title: "出水氨氮超内控，但 DO 正常：建议排查非曝气因素",
        action: null,
        reasons: [
          { label: "出水氨氮", value: `${s.effluent.nh4.toFixed(2)} mg/L，超内控 ${LIMITS.nh4InternalLimit} mg/L` },
          { label: "好氧区 DO", value: `${doVal.toFixed(2)} mg/L，处于目标范围内` },
          { label: "水温", value: `${s.influent.temp.toFixed(0)} ℃${s.influent.temp < 15 ? "，低温抑制硝化活性" : ""}` },
        ],
        dataQuality: quality,
        constraints: ["DO 正常时不盲目加曝气，避免无效能耗"],
        forecast: { note: "建议核查水温、MLSS、污泥龄及进水毒性冲击；低温工况可通过提高 MLSS 或延长泥龄改善硝化" },
        risks: ["仅提高曝气对此类氨氮升高改善有限"],
        knowledgeRef: KB.nitrification,
        expiresAtTick: s.tick + 60,
        reviewAfterTick: s.tick + 60,
      });
    }
  }

  function execute(id, operatorNote = "") {
    const a = advices.find((x) => x.id === id);
    if (!a) return { ok: false, error: "建议不存在" };
    if (a.status !== "pending") return { ok: false, error: `建议状态为 ${a.status}，不可执行` };
    if (a.expiresAtTick <= sim.state.tick) {
      a.status = "expired";
      return { ok: false, error: "建议已过期" };
    }
    if (a.type !== "adjust" || !a.action) return { ok: false, error: "该建议为排查/观察类，无调节动作" };
    if (a.blocked) return { ok: false, error: "约束未满足：距上次调节间隔不足" };

    // 执行前再次校验安全边界
    const { from, to } = a.action;
    if (to < LIMITS.doSetpointMin || to > LIMITS.doSetpointMax) {
      return { ok: false, error: "目标值超出允许范围，已拦截" };
    }
    if (Math.abs(to - from) > LIMITS.doSetpointStep + 1e-9) {
      return { ok: false, error: "单次调整步长超限，已拦截" };
    }
    if (sim.state.tick - sim.state.lastExecuteTick < LIMITS.minExecuteInterval) {
      return { ok: false, error: "距上次调节间隔不足，已拦截" };
    }
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
      reviewDueTick: sim.state.tick + LIMITS.reviewAfter,
      operatorNote: operatorNote.trim(),
      feedback: null,
    };
    commitOperations([op, ...operations]);
    sim.state.bio.doSetpoint = to;
    sim.state.lastExecuteTick = sim.state.tick;
    a.status = "executed";
    a.executedTick = sim.state.tick;
    return { ok: true, operation: op };
  }

  function ignore(id) {
    const a = advices.find((x) => x.id === id);
    if (!a || a.status !== "pending") return { ok: false, error: "建议不存在或已处理" };
    a.status = "ignored";
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
    get operations() { return operations; },
    evaluate,
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
