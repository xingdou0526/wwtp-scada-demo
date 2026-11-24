import assert from "node:assert/strict";
import { mkdtempSync, rmdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openAdviceStore } from "./advice-store.js";
import { createAdvisor } from "./advisor.js";
import { openOperationStore } from "./operation-store.js";
import { createSimulation, LIMITS } from "./simulator.js";

const risingLoad = [{ flow: 600, infNh4: 20 }, { flow: 800, infNh4: 25 }];
const normalDo = [{ do: 1.9 }];
const lowDo = Array.from({ length: 10 }, () => ({ do: 1.2 }));

function temporaryStore(t, name = "advices.json") {
  const directory = mkdtempSync(join(tmpdir(), "wwtp-advice-test-"));
  const file = join(directory, name);
  t.after(() => {
    rmSync(file, { force: true });
    rmdirSync(directory);
  });
  return file;
}

function observe(sim, advisor) {
  sim.state.measured.do = 1.9;
  advisor.evaluate(risingLoad, normalDo);
  const advice = advisor.activeAdvices.find(({ kind }) => kind === "observe");
  assert.ok(advice);
  return advice;
}

function raise(sim, advisor) {
  sim.state.measured.do = 1.2;
  advisor.evaluate(risingLoad, lowDo);
  const advice = advisor.activeAdvices.find(({ kind }) => kind === "raise");
  assert.ok(advice);
  return advice;
}

test("主动忽略和到期未处理分别留存，重新加载后可查看完整建议", (t) => {
  const file = temporaryStore(t);
  const sim = createSimulation();
  const advisor = createAdvisor(sim, openAdviceStore(file));
  const skipped = observe(sim, advisor);
  assert.ok(advisor.ignore(skipped.id).ok);

  sim.state.tick = skipped.createdTick + 60;
  const unattended = observe(sim, advisor);
  assert.deepEqual(advisor.adviceHistory.map(({ id }) => id), [skipped.id]);
  sim.state.tick = unattended.expiresAtTick;
  advisor.evaluate(risingLoad, normalDo);
  assert.deepEqual(advisor.activeAdvices, []);

  const restarted = createAdvisor(createSimulation(), openAdviceStore(file));
  assert.deepEqual(restarted.activeAdvices, []);
  const [expired, ignored] = restarted.adviceHistory;
  assert.equal(ignored.id, skipped.id);
  assert.equal(ignored.status, "ignored");
  assert.equal(expired.id, unattended.id);
  assert.equal(expired.status, "expired");
  assert.deepEqual(expired.reasons, unattended.reasons);
  assert.deepEqual(expired.forecast, unattended.forecast);
  assert.ok(Number.isFinite(Date.parse(expired.createdAt)));
  assert.ok(Number.isFinite(Date.parse(expired.endedAt)));
  assert.equal(expired.sessionId, ignored.sessionId);
});

test("复位与重启分别中断待处理建议，下一轮使用新的轮次和建议编号", (t) => {
  const file = temporaryStore(t);
  const sim = createSimulation();
  const advisor = createAdvisor(sim, openAdviceStore(file));
  const beforeReset = raise(sim, advisor);
  advisor.resetSession();
  sim.reset();
  assert.deepEqual(advisor.activeAdvices, []);
  const resetRecord = advisor.adviceHistory.find(({ id }) => id === beforeReset.id);
  assert.equal(resetRecord.status, "interrupted");
  assert.equal(resetRecord.endReason, "reset");

  const beforeRestart = raise(sim, advisor);
  assert.notEqual(beforeRestart.id, beforeReset.id);
  assert.notEqual(beforeRestart.sessionId, beforeReset.sessionId);
  const nextSim = createSimulation();
  const restarted = createAdvisor(nextSim, openAdviceStore(file));
  assert.deepEqual(restarted.activeAdvices, []);
  const restartRecord = restarted.adviceHistory.find(({ id }) => id === beforeRestart.id);
  assert.equal(restartRecord.status, "interrupted");
  assert.equal(restartRecord.endReason, "restart");
  const afterRestart = raise(nextSim, restarted);
  assert.notEqual(afterRestart.id, beforeRestart.id);
  assert.notEqual(afterRestart.sessionId, beforeRestart.sessionId);
});

test("复位保存建议历史失败时继续保留上一操作的复评约束", () => {
  const sim = createSimulation({ ...LIMITS, minExecuteInterval: 1, reviewAfter: 40 });
  let failArchive = false;
  const advisor = createAdvisor(sim, {
    saveAdvices() {
      if (failArchive) throw new Error("建议存档写入失败");
    },
  });
  const { operation } = advisor.execute(raise(sim, advisor).id);
  sim.state.tick = 15;
  const pending = raise(sim, advisor);
  assert.equal(pending.blocked, true);

  failArchive = true;
  assert.throws(() => advisor.resetSession(), /建议存档写入失败/);
  assert.deepEqual(advisor.operations, [operation]);
  assert.equal(pending.status, "pending");
  assert.equal(sim.state.bio.doSetpoint, operation.action.to);
  assert.match(advisor.execute(pending.id).error, /尚未到复评时间/);
});

test("重启时用操作记录恢复完整的已执行建议，也能查询只有操作记录的旧数据", (t) => {
  const adviceFile = temporaryStore(t);
  const operationFile = temporaryStore(t, "operations.json");
  const sim = createSimulation();
  const adviceStore = openAdviceStore(adviceFile);
  const advisor = createAdvisor(sim, { ...adviceStore, ...openOperationStore(operationFile) });
  const issued = structuredClone(raise(sim, advisor));
  const result = advisor.execute(issued.id, "核对 DO 后执行");
  assert.ok(result.ok);
  const { operation } = result;

  // 模拟操作记录已写入，而建议文件仍停留在签发时的状态。
  adviceStore.saveAdvices([issued]);
  const restarted = createAdvisor(createSimulation(), {
    ...openAdviceStore(adviceFile),
    ...openOperationStore(operationFile),
  });
  const [restored] = restarted.adviceHistory;
  assert.deepEqual(restarted.activeAdvices, []);
  assert.deepEqual(restored, {
    ...issued,
    status: "executed",
    executedTick: operation.executeTick,
    endedAt: operation.executeTime,
    endedTick: operation.executeTick,
    endedClockMinutes: operation.before.clockMinutes,
    operationId: operation.id,
  });
  assert.deepEqual(openAdviceStore(adviceFile).initialAdvices, [restored]);

  const [legacy] = createAdvisor(createSimulation(), openOperationStore(operationFile)).adviceHistory;
  assert.equal(legacy.id, issued.id);
  assert.equal(legacy.status, "executed");
  assert.equal(legacy.createdAt, null);
  assert.equal(legacy.operationId, operation.id);
  assert.equal(legacy.endedAt, operation.executeTime);
  assert.deepEqual(legacy.reasons, issued.reasons);
  assert.deepEqual(legacy.constraints, []);
});

test("同一问题从负荷观察升级为 DO 调节，并保留原建议详情和关联", () => {
  const sim = createSimulation();
  const advisor = createAdvisor(sim);
  const observation = structuredClone(observe(sim, advisor));

  sim.state.tick += 1;
  const adjustment = raise(sim, advisor);
  assert.ok(sim.state.tick < observation.expiresAtTick);
  assert.deepEqual(advisor.activeAdvices.map(({ id }) => id), [adjustment.id]);
  const archived = advisor.adviceHistory.find(({ id }) => id === observation.id);
  assert.equal(archived.status, "superseded");
  assert.equal(archived.supersededBy, adjustment.id);
  assert.deepEqual(archived.reasons, observation.reasons);
  assert.deepEqual(archived.forecast, observation.forecast);
});

test("独立的水质排查与负荷观察可并存，按优先级排列且不会重复发布", () => {
  const sim = createSimulation();
  const advisor = createAdvisor(sim);
  sim.state.effluent.nh4 = sim.LIMITS.nh4InternalLimit + 0.2;
  observe(sim, advisor);
  assert.deepEqual(advisor.activeAdvices.map(({ kind, priority }) => [kind, priority]), [
    ["inspect-nh4", "high"],
    ["observe", "low"],
  ]);
  const originalIds = advisor.activeAdvices.map(({ id }) => id);

  sim.state.tick += 1;
  advisor.evaluate(risingLoad, normalDo);
  assert.deepEqual(advisor.activeAdvices.map(({ id }) => id), originalIds);

  const [inspectionId, observationId] = originalIds;
  assert.ok(advisor.ignore(observationId).ok);
  assert.deepEqual(advisor.activeAdvices.map(({ id }) => id), [inspectionId]);
  assert.equal(advisor.adviceHistory.find(({ id }) => id === observationId)?.status, "ignored");
});

test("DO 数据异常使旧调节失效，并阻止从旧建议执行", () => {
  const sim = createSimulation();
  const advisor = createAdvisor(sim);
  const adjustment = raise(sim, advisor);

  sim.state.tick += 1;
  sim.injectFault("doOffline", true);
  sim.state.measured.do = null;
  sim.state.measured.doQuality = "bad";
  sim.state.measured.doFaultType = "offline";
  advisor.evaluate(risingLoad, lowDo);

  assert.deepEqual(advisor.activeAdvices.map(({ kind }) => kind), ["inspect-sensor"]);
  const oldAdvice = advisor.adviceHistory.find(({ id }) => id === adjustment.id);
  assert.equal(oldAdvice.status, "invalidated");
  assert.equal(oldAdvice.invalidatedBy, "conditions");
  assert.equal(advisor.execute(adjustment.id).ok, false);
  assert.equal(sim.state.bio.doSetpoint, adjustment.action.from);
  assert.deepEqual(advisor.operations, []);
});

test("超过内存条数上限时仍保留未到期的独立水质排查", () => {
  const sim = createSimulation();
  const advisor = createAdvisor(sim);
  sim.state.effluent.nh4 = sim.LIMITS.nh4InternalLimit + 0.2;
  raise(sim, advisor);
  const original = advisor.activeAdvices.find(({ kind }) => kind === "inspect-nh4");
  assert.ok(original);

  for (let tick = 1; tick <= 40; tick++) {
    sim.state.tick = tick;
    const faulty = tick % 2 === 1;
    sim.injectFault("doOffline", faulty);
    sim.injectFault("airflowFeedback", faulty);
    sim.state.measured.do = faulty ? null : 1.2;
    sim.state.measured.doQuality = faulty ? "bad" : "good";
    sim.state.measured.airflowQuality = faulty ? "bad" : "good";
    advisor.evaluate(risingLoad, lowDo);
  }

  assert.ok(sim.state.tick < original.expiresAtTick);
  assert.equal(advisor.advices.length, 50);
  assert.ok(advisor.adviceHistory.length + advisor.activeAdvices.length > 50);
  assert.equal(advisor.activeAdvices.find(({ kind }) => kind === "inspect-nh4")?.id, original.id);
});
