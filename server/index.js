import express from "express";
import cors from "cors";
import { createSimulation } from "./simulator.js";
import { createAdvisor, operationReviewStatus } from "./advisor.js";
import { openOperationStore, OperationStorageError } from "./operation-store.js";
import { ManagementError, openManagementStore } from "./management-store.js";
import { managementRoutes } from "./management-routes.js";

const app = express();
const management = openManagementStore();
const sim = createSimulation(management.data.limits);
const advisor = createAdvisor(sim, openOperationStore());
advisor.interruptReviews("restart");

app.use("/api/admin", managementRoutes(management, sim, advisor));
app.get("/api/knowledge/:id", (req, res) => {
  const entry = management.getKnowledge(req.params.id);
  if (!entry) return res.status(404).json({ error: "知识条目不存在" });
  res.json(entry);
});
app.use(cors());
app.use(express.json());

// 历史窗口：用于规则判断与前端曲线
const history = []; // 真实值
const measuredHistory = []; // 测量值（含数据质量异常）
const MAX_HISTORY = 240;

function pushHistory() {
  const s = sim.state;
  history.push({ ...sim.snapshot(), measuredDo: s.measured.do });
  measuredHistory.push({ tick: s.tick, do: s.measured.do });
  if (history.length > MAX_HISTORY) history.shift();
  if (measuredHistory.length > MAX_HISTORY) measuredHistory.shift();
}

// 先运行 120 tick 让系统进入稳态
for (let i = 0; i < 120; i++) {
  sim.tick();
  pushHistory();
}

// 每 1 秒推进 1 仿真分钟（60 倍加速）
setInterval(() => {
  sim.tick();
  pushHistory();
  advisor.evaluate(history, measuredHistory);
  try {
    advisor.reviewOperations();
  } catch (error) {
    if (!(error instanceof OperationStorageError)) throw error;
    console.error("[server] 保存复评失败，下个 tick 重试", error.cause);
  }
}, 1000);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.get("/api/state", (req, res) => {
  res.json({
    state: sim.state,
    limits: sim.LIMITS,
    terms: management.data.terms,
    history,
    activeAdvice: advisor.advices.find((a) => a.status === "pending") || null,
    advices: advisor.advices.slice(0, 20),
    operations: advisor.operations.slice(0, 20),
  });
});

app.post("/api/scenario", (req, res) => {
  const { key, enabled } = req.body;
  const ok = sim.setScenario(key, enabled);
  if (!ok) return res.status(400).json({ error: "未知场景因子" });
  res.json({ ok: true, scenario: sim.state.scenario });
});

app.post("/api/fault", (req, res) => {
  const { type, enabled } = req.body;
  const ok = sim.injectFault(type, enabled);
  if (!ok) return res.status(400).json({ error: "未知异常类型" });
  res.json({ ok: true, fault: sim.state.fault });
});

app.post("/api/advice/:id/execute", (req, res) => {
  const result = advisor.execute(req.params.id, req.body?.operatorNote);
  if (!result.ok) return res.status(400).json(result);
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

app.post("/api/reset", (req, res) => {
  advisor.interruptReviews("reset");
  sim.reset();
  history.length = 0;
  measuredHistory.length = 0;
  advisor.advices.length = 0;
  for (let i = 0; i < 60; i++) {
    sim.tick();
    pushHistory();
  }
  res.json({ ok: true });
});

app.use((error, _req, res, next) => {
  if (error instanceof ManagementError) {
    if (error.cause) console.error("[server] 保存后台配置失败", error.cause);
    return res.status(error.status).json({ ok: false, error: error.message });
  }
  if (error.type === "entity.too.large") return res.status(413).json({ error: "提交的内容过大" });
  if (error.type === "entity.parse.failed") return res.status(400).json({ error: "请求数据格式无效" });
  if (!(error instanceof OperationStorageError)) return next(error);
  console.error("[server] 保存操作记录失败", error.cause);
  res.status(503).json({ ok: false, error: error.message });
});

const PORT = Number(process.env.WWTP_PORT ?? 3001);
app.listen(PORT, "127.0.0.1", () => {
  console.log(`[server] API listening on http://127.0.0.1:${PORT}`);
});
