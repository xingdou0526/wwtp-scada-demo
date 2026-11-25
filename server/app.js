import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import cors from "cors";
import { createSimulation } from "./simulator.js";
import { createAdvisor, operationReviewStatus } from "./advisor.js";
import { runBaselineCompare } from "./baseline-compare.js";
import { gzipMiddleware } from "./compress.js";
import { AdviceStorageError, openAdviceStore } from "./advice-store.js";
import { openOperationStore, OperationStorageError } from "./operation-store.js";
import { ManagementError, openManagementStore } from "./management-store.js";
import { managementRoutes } from "./management-routes.js";

const MAX_HISTORY = 240;
const WARMUP_TICKS = 120;
const REVIEW_TICK_SECONDS = 10;
const MAX_FAST_FORWARD = 60;
const SSE_HEARTBEAT_MS = 20000;

function secondsPerTick(advices) {
  return advices.some((advice) => advice.type === "adjust" && advice.action && !advice.blocked) ? REVIEW_TICK_SECONDS : 1;
}

export function normalizeBasePath(raw) {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}` : "";
}

function renderIndexHtml(rawHtml, basePath) {
  const assetBase = `${basePath}/assets/`;
  const rewritten = rawHtml.replace(/(src|href)=(["'])\.?\/assets\//g, `$1=$2${assetBase}`);
  const serialized = JSON.stringify(basePath).replace(/</g, "\\u003c");
  const injection = `<script>window.__WWTP_BASE_PATH__=${serialized};</script>`;
  return rewritten.includes("</head>")
    ? rewritten.replace("</head>", `  ${injection}\n  </head>`)
    : `${injection}${rewritten}`;
}

export function createApp({
  managementFile,
  operationsFile,
  adviceFile,
  staticDir,
  basePath = "",
  autoStart = true,
  random,
} = {}) {
  const normalizedBase = normalizeBasePath(basePath);
  const app = express();
  const router = express.Router();
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
  const sseClients = new Set();
  let cachedCompare = null;
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

  function buildCorePayload() {
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

  function buildStatePayload() {
    return {
      ...buildCorePayload(),
      terms: management.data.terms,
      history,
    };
  }

  function buildDeltaPayload() {
    return {
      ...buildCorePayload(),
      latestPoint: history[history.length - 1] ?? null,
    };
  }

  function getBaselineCompare() {
    if (cachedCompare && cachedCompare.limits === sim.LIMITS) return cachedCompare.result;
    const result = runBaselineCompare(sim.LIMITS);
    cachedCompare = { limits: sim.LIMITS, result };
    return result;
  }

  function safeWriteSse(client, frame) {
    if (client.writableEnded || client.destroyed) {
      sseClients.delete(client);
      return false;
    }
    try {
      client.write(frame);
      return true;
    } catch {
      sseClients.delete(client);
      return false;
    }
  }

  function sendSse(res, event, data) {
    safeWriteSse(res, `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function broadcast(event, payloadFactory) {
    if (!sseClients.size) return;
    const payload = payloadFactory();
    const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of [...sseClients]) {
      safeWriteSse(client, frame);
    }
  }

  const broadcastUpdate = () => broadcast("update", buildDeltaPayload);
  const broadcastSnapshot = () => broadcast("snapshot", buildStatePayload);

  warmup();

  // CORS 与 Gzip 必须注册在所有业务路由之前
  app.use(cors());
  app.use(gzipMiddleware);
  router.use("/api/admin", managementRoutes(management, sim, advisor, broadcastSnapshot));
  router.get("/api/knowledge/:id", (req, res) => {
    const entry = management.getKnowledge(req.params.id);
    if (!entry) return res.status(404).json({ error: "知识条目不存在" });
    res.json(entry);
  });
  router.use(express.json());

  const timer = autoStart
    ? setInterval(() => {
        if (paused) return;
        secondsIntoTick += 1;
        const tickSeconds = secondsPerTick(advisor.activeAdvices);
        if (!stepRequested && secondsIntoTick < tickSeconds) {
          // 审阅降速期间每 2 秒同步一次倒计时
          if (tickSeconds > 1 && secondsIntoTick % 2 === 0) broadcastUpdate();
          return;
        }
        secondsIntoTick = 0;
        stepRequested = false;
        stepOnce();
        broadcastUpdate();
      }, 1000)
    : null;

  const heartbeat = autoStart
    ? setInterval(() => {
        for (const client of [...sseClients]) safeWriteSse(client, ": ping\n\n");
      }, SSE_HEARTBEAT_MS)
    : null;

  const healthHandler = (_req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  };
  router.get("/api/health", healthHandler);

  router.get("/api/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    const cleanup = () => sseClients.delete(res);
    sseClients.add(res);
    req.on("close", cleanup);
    res.on("close", cleanup);
    res.on("error", cleanup);
    sendSse(res, "snapshot", buildStatePayload());
  });

  router.get("/api/state", (_req, res) => {
    res.json(buildStatePayload());
  });

  router.get("/api/compare", (_req, res) => {
    res.json(getBaselineCompare());
  });

  router.get("/api/advice/history", (_req, res) => {
    res.json({ advices: advisor.adviceHistory });
  });

  router.post("/api/sim/pause", (req, res) => {
    const { paused: nextPaused } = req.body ?? {};
    if (typeof nextPaused !== "boolean") return res.status(400).json({ error: "请提供有效的暂停状态" });
    paused = nextPaused;
    broadcastUpdate();
    res.json({ ok: true, paused, snapshot: buildStatePayload() });
  });

  router.post("/api/sim/fast-forward", (req, res) => {
    const raw = req.body?.minutes ?? 30;
    if (!Number.isSafeInteger(raw) || raw < 1 || raw > MAX_FAST_FORWARD) {
      return res.status(400).json({ error: `快进分钟数须为 1 至 ${MAX_FAST_FORWARD} 的整数` });
    }
    secondsIntoTick = 0;
    stepRequested = false;
    for (let i = 0; i < raw; i++) stepOnce();
    broadcastSnapshot();
    res.json({ ok: true, advanced: raw, snapshot: buildStatePayload() });
  });

  router.post("/api/preset", (req, res) => {
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
    broadcastSnapshot();
    res.json({ ok: true, preset, snapshot: buildStatePayload() });
  });

  router.post("/api/scenario", (req, res) => {
    const { key, enabled } = req.body ?? {};
    const ok = sim.setScenario(key, enabled);
    if (!ok) return res.status(400).json({ error: "未知场景因子" });
    activePreset = null;
    secondsIntoTick = 0;
    stepRequested = false;
    stepOnce();
    broadcastUpdate();
    res.json({ ok: true, scenario: sim.state.scenario, snapshot: buildStatePayload() });
  });

  router.post("/api/fault", (req, res) => {
    const { type, enabled } = req.body ?? {};
    const ok = sim.injectFault(type, enabled);
    if (!ok) return res.status(400).json({ error: "未知异常类型" });
    activePreset = null;
    secondsIntoTick = 0;
    stepRequested = false;
    stepOnce();
    broadcastUpdate();
    res.json({ ok: true, fault: sim.state.fault, snapshot: buildStatePayload() });
  });

  router.post("/api/advice/:id/execute", (req, res) => {
    const result = advisor.execute(req.params.id, req.body?.operatorNote);
    if (!result.ok) return res.status(400).json(result);
    const { id, executeTick, action } = result.operation;
    sessionMarkers.push({ id, tick: executeTick, from: action.from, to: action.to });
    broadcastUpdate();
    res.json({ ...result, snapshot: buildStatePayload() });
  });

  router.post("/api/advice/:id/ignore", (req, res) => {
    const result = advisor.ignore(req.params.id);
    if (!result.ok) return res.status(400).json(result);
    broadcastUpdate();
    res.json({ ...result, snapshot: buildStatePayload() });
  });

  router.get("/api/operations", (req, res) => {
    const { reviewStatus } = req.query;
    if (reviewStatus !== undefined && !["pending", "reviewed", "interrupted"].includes(reviewStatus)) {
      return res.status(400).json({ error: "无效的复评状态" });
    }
    const operations = advisor.operations.filter((op) => !reviewStatus || operationReviewStatus(op) === reviewStatus);
    res.json({ operations });
  });

  router.post("/api/operations/:id/feedback", (req, res) => {
    const result = advisor.updateFeedback(req.params.id, req.body);
    if (!result.ok) return res.status(result.status).json({ ok: false, error: result.error });
    res.json(result);
  });

  router.post("/api/reset", (_req, res) => {
    resetAll();
    broadcastSnapshot();
    res.json({ ok: true, snapshot: buildStatePayload() });
  });

  if (staticDir && existsSync(join(staticDir, "index.html"))) {
    const indexHtml = renderIndexHtml(readFileSync(join(staticDir, "index.html"), "utf8"), normalizedBase);
    const sendIndex = (_req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.send(indexHtml);
    };
    router.get(["/", "/index.html"], sendIndex);
    router.use(express.static(staticDir, {
      index: false,
      setHeaders(res, filePath) {
        if (/[\\/]assets[\\/]/.test(filePath)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }));
    router.get(/^(?!\/(?:api|assets)(?:\/|$)).*/, sendIndex);
  }

  app.use(normalizedBase || "/", router);
  if (normalizedBase) {
    // 保留根健康检查便于容器 HEALTHCHECK 探活，根路径重定向到上下文路径
    app.get("/api/health", healthHandler);
    app.get("/", (_req, res) => res.redirect(302, normalizedBase));
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
      if (heartbeat) clearInterval(heartbeat);
      for (const client of [...sseClients]) {
        try {
          client.end();
        } catch {
          // Ignore already-closed SSE connections on shutdown.
        }
      }
      sseClients.clear();
    },
  };
}
