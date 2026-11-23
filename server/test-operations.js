import assert from "node:assert/strict";
import { mkdtempSync, rmdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAdvisor, operationReviewStatus } from "./advisor.js";
import { openOperationStore } from "./operation-store.js";
import { createSimulation } from "./simulator.js";

function temporaryStore(t) {
  const directory = mkdtempSync(join(tmpdir(), "wwtp-operation-test-"));
  const file = join(directory, "operations.json");
  t.after(() => {
    rmSync(file, { force: true });
    rmdirSync(directory);
  });
  return file;
}

function adjustment(advisor) {
  advisor.evaluate([], Array.from({ length: 10 }, () => ({ do: 1 })));
  const advice = advisor.advices[0];
  assert.equal(advice?.kind, "raise");
  return advice;
}

test("执行、到期复评和人工反馈可从本地文件重新加载", (t) => {
  const file = temporaryStore(t);
  const sim = createSimulation();
  const advisor = createAdvisor(sim, openOperationStore(file));
  const { operation } = advisor.execute(adjustment(advisor).id, "执行备注");
  assert.deepEqual(openOperationStore(file).initialOperations, [operation]);

  for (let i = 1; i < sim.LIMITS.reviewAfter; i++) sim.tick();
  advisor.reviewOperations();
  assert.equal(advisor.operations[0].after, null);
  sim.tick();
  advisor.reviewOperations();
  const reviewed = advisor.operations[0];
  assert.equal(reviewed.after.tick, reviewed.reviewDueTick);
  assert.equal(reviewed.after.doSetpoint, 2.2);

  const { operation: updated } = advisor.updateFeedback(operation.id, { evaluation: " 继续观察 ", effective: false });
  assert.equal(updated.operatorNote, "执行备注");
  assert.equal(updated.feedback.evaluation, "继续观察");
  assert.equal(updated.feedback.effective, false);
  assert.deepEqual(updated.after, reviewed.after);
  assert.equal(advisor.updateFeedback(operation.id, { effective: "false" }).status, 400);
  assert.deepEqual(openOperationStore(file).initialOperations, [updated]);
});

test("中断的复评保留记录且不会使用下一轮仿真数据", (t) => {
  const file = temporaryStore(t);
  const original = createAdvisor(createSimulation(), openOperationStore(file));
  const { operation } = original.execute(adjustment(original).id);
  const nextSim = createSimulation();
  const restarted = createAdvisor(nextSim, openOperationStore(file));
  restarted.interruptReviews("restart");
  const next = restarted.execute(adjustment(restarted).id).operation;
  assert.notEqual(next.id, operation.id);
  restarted.interruptReviews("reset");
  nextSim.reset();
  for (let i = 0; i < 120; i++) nextSim.tick();
  restarted.reviewOperations();
  assert.deepEqual(openOperationStore(file).initialOperations, [
    { ...next, reviewInterrupted: "reset" },
    { ...operation, reviewInterrupted: "restart" },
  ]);
  assert.equal(operationReviewStatus(restarted.operations[0]), "interrupted");
});

test("记录写入失败时保留待处理建议与原 DO 目标", () => {
  const sim = createSimulation();
  const advisor = createAdvisor(sim, { saveOperations() { throw new Error("写入失败"); } });
  const advice = adjustment(advisor);
  assert.throws(() => advisor.execute(advice.id), /写入失败/);
  assert.equal(advice.status, "pending");
  assert.equal(sim.state.bio.doSetpoint, 2.0);
  assert.deepEqual(advisor.operations, []);
});
