// 曝气 AI 辅助决策规则引擎：只输出建议，执行必须人工触发
import { randomUUID } from "node:crypto";
import {
  adviceRank,
  buildAirflowCapInspect,
  buildAirflowInspect,
  buildLowerAdvice,
  buildMonitorStatus,
  buildNh4Inspect,
  buildObserveAdvice,
  buildRaiseAdvice,
  buildSensorInspect,
  buildSetpointCapInspect,
  compareAdviceIdDesc,
} from "./advice-builders.js";

const MAX_NOTE_LENGTH = 1000;
const MAX_PERSISTED_ADVICES = 500;

function pruneRecords(list, limit) {
  if (!Number.isFinite(limit) || limit <= 0 || list.length <= limit) return list;
  const pending = [];
  const executed = [];
  const archived = [];
  for (const item of list) {
    if (item.status === "pending") pending.push(item);
    else if (item.status === "executed") executed.push(item);
    else archived.push(item);
  }
  const budget = Math.max(0, limit - pending.length);
  const keptExecuted = executed.slice(0, budget);
  const keptArchived = archived.slice(0, Math.max(0, budget - keptExecuted.length));
  const keepIds = new Set([...pending, ...keptExecuted, ...keptArchived].map(({ id }) => id));
  return list.filter(({ id }) => keepIds.has(id));
}

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

export function createAdvisor(sim, {
  initialOperations = [], saveOperations = () => {},
  initialAdvices = [], saveAdvices = () => {},
  maxAdvices = MAX_PERSISTED_ADVICES,
} = {}) {
  let adviceSeq = 0;
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
  const reconciled = initialAdvices.map((advice) => {
    if (advice.status !== "pending") return advice;
    const operation = operationsByAdvice.get(advice.id);
    return operation ? executedRecord(advice, operation) : {
      ...advice, status: "interrupted", endReason: "restart", endedAt: restartedAt,
      endedTick: null, endedClockMinutes: null,
    };
  });
  let records = pruneRecords(reconciled, maxAdvices);
  if (records.length !== initialAdvices.length || records.some((record, index) => record !== initialAdvices[index])) {
    saveAdvices(records);
  }

  function commitOperations(next) {
    saveOperations(next);
    operations = next;
  }

  function commitAdvices(next) {
    const pruned = pruneRecords(next, maxAdvices);
    saveAdvices(pruned);
    records = pruned;
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
      .sort((a, b) => (b.createdAt ?? b.endedAt ?? "").localeCompare(a.createdAt ?? a.endedAt ?? "") || compareAdviceIdDesc(a.id, b.id));
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

  function hasDoSensorFault(state) {
    const { measured, fault } = state;
    return measured.do === null || measured.doQuality !== "good" ||
      fault.doDrift || fault.doStuck || fault.doSpike || fault.doOffline;
  }

  function adjustmentRestriction(action) {
    const { measured, fault, bio, effluent, influent, scenario } = sim.state;
    const limits = sim.LIMITS;
    if (fault.airflowFeedback || measured.airflowQuality !== "good") return "风量反馈不可信，请先排查仪表";
    if (hasDoSensorFault(sim.state)) return "DO 测量数据不可信，请先排查仪表";
    if (action.from !== bio.doSetpoint) return "当前 DO 目标值已变化，请查看新建议";
    if (action.to > action.from && bio.airflow > limits.airflowMax * 0.95) return "风量已接近上限，请先核查供氧能力";
    if (action.to < action.from && (scenario.shock || scenario.storm || loadRising ||
      !(scenario.night || influent.flow < 700) || effluent.nh4 >= Math.min(0.5, limits.nh4InternalLimit))) {
      return "当前负荷或出水氨氮已超出节能调节条件";
    }
    return "";
  }

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
    const flowRising = Boolean(flowWin && flowWin.last > flowWin.first * 1.15);
    const nh4Rising = Boolean(nh4Win && nh4Win.last > nh4Win.first * 1.2);
    loadRising = flowRising || nh4Rising;
    const doVal = s.measured.do;
    const quality = s.measured.doQuality;
    const sensorIssue = hasDoSensorFault(s);
    const airflowIssue = s.fault.airflowFeedback || s.measured.airflowQuality !== "good";
    const doWin = windowStats(measuredHistory, "do", 10);
    const doHighWin = windowStats(measuredHistory, "do", 15);
    const lowDo = Boolean(doWin && doWin.avg < s.bio.doSetpoint - 0.35);
    const highDo = Boolean(doHighWin && doHighWin.avg > s.bio.doSetpoint + 0.7);
    const nearAirflowCap = s.bio.airflow > limits.airflowMax * 0.95;
    const atSetpointMax = s.bio.doSetpoint >= limits.doSetpointMax - 1e-9;
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
      if (advice.kind === "inspect-setpoint-cap") return sensorIssue || airflowIssue || nearAirflowCap || !atSetpointMax || !lowDo;
      if (advice.kind === "observe") return sensorIssue || airflowIssue || !loadRising;
      return advice.kind === "inspect-nh4" && (!overNh4Limit || (advice.assumesNormalDo && !normalDo));
    });
    finishAdvices(changed, "invalidated", "conditions", { invalidatedBy: "conditions" });

    function cooledDown(kind, ticks) {
      const last = advices.find((a) => a.kind === kind && !a.invalidatedBy);
      return !last || (last.status !== "pending" && s.tick - last.createdTick >= ticks);
    }

    if (overNh4Limit && cooledDown("inspect-nh4", 60)) {
      addAdvice(buildNh4Inspect(s, limits, { normalDo, doVal, quality }));
    }

    const restriction = executionRestriction();

    if (sensorIssue && cooledDown("inspect-sensor", 30)) {
      addAdvice(buildSensorInspect(s, quality));
    }

    if (airflowIssue && cooledDown("inspect-airflow", 30)) {
      addAdvice(buildAirflowInspect(s));
    }

    if (sensorIssue || airflowIssue || !doWin) return;
    const pendingDo = pendingAdvices();
    if (pendingDo.some((advice) => advice.action || advice.kind === "inspect-cap" || advice.kind === "inspect-setpoint-cap")) return;
    const observation = pendingDo.find((advice) => advice.kind === "observe");

    // R1：DO 持续低于目标 → 建议上调 DO 目标值；已达风量或目标上限时改为排查提示
    if (lowDo) {
      if (nearAirflowCap) {
        if (cooledDown("inspect-cap", 60)) addAdvice(buildAirflowCapInspect(s, doVal, quality), observation);
        return;
      }
      const to = round1(Math.min(limits.doSetpointMax, s.bio.doSetpoint + limits.doSetpointStep));
      if (to === s.bio.doSetpoint) {
        if (cooledDown("inspect-setpoint-cap", 60)) addAdvice(buildSetpointCapInspect(s, limits, doWin, quality), observation);
        return;
      }
      if (!cooledDown("raise", 15)) return;
      addAdvice(buildRaiseAdvice(s, limits, { doWin, to, quality, restriction, observation }), observation);
      return;
    }

    // R2：DO 持续偏高且负荷较低 → 节能下调
    const lowLoad = s.scenario.night || s.influent.flow < 700;
    if (
      highDo &&
      s.effluent.nh4 < Math.min(0.5, limits.nh4InternalLimit) && lowLoad &&
      s.bio.doSetpoint > limits.doSetpointMin &&
      !s.scenario.shock && !s.scenario.storm && !loadRising &&
      cooledDown("lower", 90)
    ) {
      const to = round1(Math.max(limits.doSetpointMin, s.bio.doSetpoint - limits.doSetpointStep));
      addAdvice(buildLowerAdvice(s, limits, { doHighWin, to, quality, restriction }));
      return;
    }

    // R3：进水负荷快速上升的前瞻提示（DO 尚未跌破时）
    if (loadRising && doVal > s.bio.doSetpoint - 0.35 && cooledDown("observe", 60)) {
      addAdvice(buildObserveAdvice(s, { flowRising, flowWin, nh4Win, doVal, quality }));
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

    const { from, to } = a.action;
    if (to < limits.doSetpointMin || to > limits.doSetpointMax) return { ok: false, error: "目标值超出允许范围，已拦截" };
    if (Math.abs(to - from) > limits.doSetpointStep + 1e-9) return { ok: false, error: "单次调整步长超限，已拦截" };
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
      after: null,
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

  function cooldownRemaining(kind, ticks) {
    const last = advices.find((a) => a.kind === kind && !a.invalidatedBy);
    if (!last || last.status === "pending") return 0;
    return Math.max(0, ticks - (sim.state.tick - last.createdTick));
  }

  function monitorStatus(history, measuredHistory) {
    const s = sim.state;
    const pendingReview = operations.find((op) => operationReviewStatus(op) === "pending" && op.reviewDueTick > s.tick);
    const flowWin = windowStats(history, "flow", 60);
    const nh4Win = windowStats(history, "infNh4", 60);
    const rising = Boolean(
      (flowWin && flowWin.last > flowWin.first * 1.15) ||
      (nh4Win && nh4Win.last > nh4Win.first * 1.2),
    );
    return buildMonitorStatus(s, sim.LIMITS, {
      doWin: windowStats(measuredHistory, "do", 10),
      doHighWin: windowStats(measuredHistory, "do", 15),
      loadRising: rising,
      pendingReviewTicks: pendingReview ? pendingReview.reviewDueTick - s.tick : 0,
      raiseCooldown: cooldownRemaining("raise", 15),
      lowerCooldown: cooldownRemaining("lower", 90),
    });
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
    monitorStatus,
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
