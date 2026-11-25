import { existsSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import cors from "cors";
import { createSimulation } from "./simulator.js";
import { createAdvisor, operationReviewStatus } from "./advisor.js";
import { runBaselineCompare } from "./baseline-compare.js";
import { AdviceStorageError, openAdviceStore } from "./advice-store.js";
import { openOperationStore, OperationStorageError } from "./operation-store.js";
import { ManagementError, openManagementStore } from "./management-store.js";
import { managementRoutes } from "./management-routes.js";

const MAX_HISTORY = 240;
const WARMUP_TICKS = 120;
const REVIEW_TICK_SECONDS = 10;
const MAX_FAST_FORWARD = 60;

function secondsPerTick(advices) {
  return advices.some((advice) => advice.type === "adjust" && advice.action && !advice.blocked) ? REVIEW_TICK_SECONDS : 1;
}

export function createApp({
  managementFile,
  operationsFile,
  adviceFile,
  staticDir,
  autoStart = true,
  random,
} = {}) {
  const app = express();
  const management = openManagementStore(managementFile);
  const sim = createSimulation(management.data.limits, { random });
  const advisor = createAdvisor(sim, {
    ...openOperationStore(operationsFile),
    ...openAdviceStore(adviceFile),
  });
  advisor.interruptReviews("restart");

  const history = [];
  const measuredHistory = [];
  const sessionMarkers = [];
  let secondsIntoTick = 0;
  let stepRequested = false;
  let paused = false;
  let activePreset = null;

  function pushHistory() {
    const s = sim.state;
    history.push({ ...sim.snapshot(), measuredDo: s.measured.do });
    measuredHistory.push({ tick: s.tick, do: s.measured.do });
    if (history.length > MAX_HISTORY) history.shift();
    if (measuredHistory.length > MAX_HISTORY) measuredHistory.shift();
  }

  function warmup(ticks = WARMUP_TICKS) {
    for (let i = 0; i < ticks; i++) {
      sim.tick();
      pushHistory();
    }
  }

  function stepOnce() {
    sim.tick();
    pushHistory();
    try {
      advisor.evaluate(history, measuredHistory);
    } catch (error) {
      if (!(error instanceof AdviceStorageError)) throw error;
      console.error("[server] 保存建议状态失败，下个 tick 重试", error.cause);
    }
    try {
      advisor.reviewOperations();
    } catch (error) {
      if (!(error instanceof OperationStorageError)) throw error;
      console.error("[server] 保存复评失败，下个 tick 重试", error.cause);
    }
  }

  function resetAll() {
    advisor.resetSession();
    sim.reset();
    history.length = 0;
    measuredHistory.length = 0;
    sessionMarkers.length = 0;
    secondsIntoTick = 0;
    stepRequested = false;
    paused = false;
    activePreset = null;
    warmup();
  }

  warmup();

  // CORS 必须注册在所有业务路由之前，避免 /api/admin 与 /api/knowledge 缺失跨域头
  app.use(cors());
  app.use("/api/admin", managementRoutes(management, sim, advisor));
  app.get("/api/knowledge/:id", (req, res) => {
    const entry = management.getKnowledge(req.params.id);
    if (!entry) return res.status(404).json({ error: "知识条目不存在" });
    res.json(entry);
  });
  app.use(express.json());

  const timer = autoStart
    ? setInterval(() => {
        if (paused) return;
        secondsIntoTick += 1;
        if (!stepRequested && secondsIntoTick < secondsPerTick(advisor.activeAdvices)) return;
        secondsIntoTick = 0;
        stepRequested = false;
        stepOnce();
      }, 1000)
    : null;

  function buildStatePayload() {
    const pending = advisor.activeAdvices;
    const tickSeconds = secondsPerTick(pending);
    const untilNextTick = stepRequested ? 1 : tickSeconds - secondsIntoTick;
    const activeAdvices = pending.map((advice) => ({
      ...advice,
      remainingSeconds: (advice.expiresAtTick - sim.state.tick - 1) * tickSeconds + Math.max(1, untilNextTick),
    }));
    const activeAdvice = activeAdvices[0] ?? null;
    const firstTick = history[0]?.tick ?? 0;
    const markers = sessionMarkers.filter((marker) => marker.tick >= firstTick);
    return {
      state: sim.state,
      limits: sim.LIMITS,
      terms: management.data.terms,
      history,
      markers,
      activePreset,
      activeAdvice,
      activeAdvices,
      monitorStatus: advisor.monitorStatus(history, measuredHistory),
      timing: {
        secondsPerTick: tickSeconds,
        adviceRemainingSeconds: activeAdvice?.remainingSeconds ?? 0,
        paused,
      },
    };
  }

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  app.get("/api/state", (_req, res) => {
    res.json(buildStatePayload());
  });

  app.get("/api/compare", (_req, res) => {
    res.json(runBaselineCompare(sim.LIMITS));
  });

  app.get("/api/advice/history", (_req, res) => {
    res.json({ advices: advisor.adviceHistory });
  });

  app.post("/api/sim/pause", (req, res) => {
    const { paused: nextPaused } = req.body ?? {};
    if (typeof nextPaused !== "boolean") return res.status(400).json({ error: "请提供有效的暂停状态" });
    paused = nextPaused;
    res.json({ ok: true, paused, snapshot: buildStatePayload() });
  });

  app.post("/api/sim/fast-forward", (req, res) => {
    const raw = req.body?.minutes ?? 30;
    if (!Number.isSafeInteger(raw) || raw < 1 || raw > MAX_FAST_FORWARD) {
      return res.status(400).json({ error: `快进分钟数须为 1 至 ${MAX_FAST_FORWARD} 的整数` });
    }
    secondsIntoTick = 0;
    stepRequested = false;
    for (let i = 0; i < raw; i++) stepOnce();
    res.json({ ok: true, advanced: raw, snapshot: buildStatePayload() });
  });

  app.post("/api/preset", (req, res) => {
    const { preset } = req.body ?? {};
    if (!["shock", "night", "fault"].includes(preset)) {
      return res.status(400).json({ error: "未知快捷演示场景" });
    }
    resetAll();
    if (preset === "shock") {
      sim.setScenario("shock", true);
      for (let i = 0; i < 40; i++) {
        stepOnce();
        if (advisor.activeAdvices.some((a) => a.kind === "raise" && !a.blocked)) break;
      }
    } else if (preset === "night") {
      sim.setScenario("night", true);
      for (let i = 0; i < 90; i++) {
        stepOnce();
        if (advisor.activeAdvices.some((a) => a.kind === "lower" && !a.blocked)) break;
      }
    } else if (preset === "fault") {
      sim.setScenario("shock", true);
      for (let i = 0; i < 40; i++) {
        stepOnce();
        if (advisor.activeAdvices.some((a) => a.kind === "raise" && !a.blocked)) break;
      }
      sim.injectFault("doDrift", true);
      sim.injectFault("airflowFeedback", true);
      for (let i = 0; i < 8; i++) stepOnce();
    }
    activePreset = preset;
    res.json({ ok: true, preset, snapshot: buildStatePayload() });
  });

  app.post("/api/scenario", (req, res) => {
    const { key, enabled } = req.body ?? {};
    const ok = sim.setScenario(key, enabled);
    if (!ok) return res.status(400).json({ error: "未知场景因子" });
    activePreset = null;
    secondsIntoTick = 0;
    stepRequested = false;
    stepOnce();
    res.json({ ok: true, scenario: sim.state.scenario, snapshot: buildStatePayload() });
  });

  app.post("/api/fault", (req, res) => {
    const { type, enabled } = req.body ?? {};
    const ok = sim.injectFault(type, enabled);
    if (!ok) return res.status(400).json({ error: "未知异常类型" });
    activePreset = null;
    secondsIntoTick = 0;
    stepRequested = false;
    stepOnce();
    res.json({ ok: true, fault: sim.state.fault, snapshot: buildStatePayload() });
  });

  app.post("/api/advice/:id/execute", (req, res) => {
    const result = advisor.execute(req.params.id, req.body?.operatorNote);
    if (!result.ok) return res.status(400).json(result);
    const { id, executeTick, action } = result.operation;
    sessionMarkers.push({ id, tick: executeTick, from: action.from, to: action.to });
    res.json(result);
  });

  app.post("/api/advice/:id/ignore", (req, res) => {
    const result = advisor.ignore(req.params.id);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  });

  app.get("/api/operations", (req, res) => {
    const { reviewStatus } = req.query;
    if (reviewStatus !== undefined && !["pending", "reviewed", "interrupted"].includes(reviewStatus)) {
      return res.status(400).json({ error: "无效的复评状态" });
    }
    const operations = advisor.operations.filter((op) => !reviewStatus || operationReviewStatus(op) === reviewStatus);
    res.json({ operations });
  });

  app.post("/api/operations/:id/feedback", (req, res) => {
    const result = advisor.updateFeedback(req.params.id, req.body);
    if (!result.ok) return res.status(result.status).json({ ok: false, error: result.error });
    res.json(result);
  });

  app.post("/api/reset", (_req, res) => {
    resetAll();
    res.json({ ok: true, snapshot: buildStatePayload() });
  });

  if (staticDir && existsSync(join(staticDir, "index.html"))) {
    app.use(express.static(staticDir));
    app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
      res.sendFile(join(staticDir, "index.html"));
    });
  }

  app.use((error, _req, res, next) => {
    if (error instanceof ManagementError) {
      if (error.cause) console.error("[server] 保存后台配置失败", error.cause);
      return res.status(error.status).json({ ok: false, error: error.message });
    }
    if (error.type === "entity.too.large") return res.status(413).json({ error: "提交的内容过大" });
    if (error.type === "entity.parse.failed") return res.status(400).json({ error: "请求数据格式无效" });
    if (error instanceof AdviceStorageError) {
      console.error("[server] 保存历史建议失败", error.cause);
      return res.status(503).json({ ok: false, error: error.message });
    }
    if (!(error instanceof OperationStorageError)) return next(error);
    console.error("[server] 保存操作记录失败", error.cause);
    res.status(503).json({ ok: false, error: error.message });
  });

  return {
    app,
    sim,
    advisor,
    management,
    stepOnce,
    close() {
      if (timer) clearInterval(timer);
    },
  };
}
