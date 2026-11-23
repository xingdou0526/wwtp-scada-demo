import assert from "node:assert/strict";
import { mkdtempSync, rmdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAdvisor } from "./advisor.js";
import { KNOWLEDGE_REFS } from "./management-defaults.js";
import { openManagementStore } from "./management-store.js";
import { createSimulation, LIMITS } from "./simulator.js";

function temporaryStore(t) {
  const directory = mkdtempSync(join(tmpdir(), "wwtp-management-test-"));
  const file = join(directory, "management.json");
  t.after(() => {
    rmSync(file, { force: true });
    rmdirSync(directory);
  });
  return file;
}

test("知识条目保留 Markdown 原文，规则引用可编辑并且不能删除", (t) => {
  const file = temporaryStore(t);
  const store = openManagementStore(file);
  assert.deepEqual(store.data.knowledge.map(({ id }) => id), Object.values(KNOWLEDGE_REFS));
  const guide = { title: "运行检查", format: "markdown", content: "# 运行检查\n\n  - DO\n" };
  const custom = store.createKnowledge({ id: "KB-TEST-001", ...guide });
  assert.throws(() => store.createKnowledge(custom), { status: 409 });
  const linked = store.updateKnowledge(KNOWLEDGE_REFS.aeration, guide);
  assert.equal(linked.ruleLinked, true);
  assert.throws(() => store.deleteKnowledge(linked.id), { status: 409 });

  const restarted = openManagementStore(file);
  assert.deepEqual(restarted.getKnowledge(linked.id), linked);
  assert.equal(restarted.getKnowledge(custom.id).content, guide.content);
  restarted.deleteKnowledge(custom.id);
  assert.equal(openManagementStore(file).getKnowledge(custom.id), undefined);
});

test("术语库预置 16 条，可新增、编辑和删除，术语及别名不能重复", (t) => {
  const file = temporaryStore(t);
  const store = openManagementStore(file);
  assert.equal(store.data.terms.length, 16);
  assert.throws(() => store.createTerm({ term: "测试", definition: "测试", aliases: ["ＤＯ"] }), { status: 409 });
  const created = store.createTerm({ term: "测试", definition: "测试释义", aliases: ["测试简称"] });
  const updated = store.updateTerm(created.id, { term: "新版测试", definition: "新版释义", aliases: [] });
  assert.deepEqual(openManagementStore(file).data.terms.find(({ id }) => id === created.id), updated);
  store.deleteTerm(created.id);
  assert.equal(openManagementStore(file).data.terms.length, 16);
});

test("新配置使待执行建议失效，已执行操作沿用当时的复评时间", (t) => {
  const file = temporaryStore(t);
  const store = openManagementStore(file);
  const sim = createSimulation(store.data.limits);
  const advisor = createAdvisor(sim);
  const lowDo = Array.from({ length: 10 }, () => ({ do: 1 }));
  advisor.evaluate([], lowDo);
  const stale = advisor.advices[0];
  assert.equal(stale.action.to, 2.2);

  assert.throws(() => store.updateLimits({ ...LIMITS, doSetpointMin: 2.1 }, sim.state.bio.doSetpoint), /当前目标值/);
  assert.throws(() => store.updateLimits({ ...LIMITS, doSetpointStep: 0.15 }, sim.state.bio.doSetpoint), /一位小数/);
  const limits = store.updateLimits({ ...LIMITS, doSetpointStep: 0.3, reviewAfter: 20, minExecuteInterval: 1 }, sim.state.bio.doSetpoint);
  sim.configureLimits(limits);
  advisor.invalidatePending();
  assert.equal(sim.state.bio.doSetpoint, 2);
  assert.match(advisor.execute(stale.id).error, /规则参数已更新/);
  advisor.evaluate([], lowDo);
  const replacement = advisor.advices[0];
  assert.equal(replacement.action.to, 2.3);
  assert.equal(replacement.knowledgeRef, KNOWLEDGE_REFS.aeration);
  const { operation } = advisor.execute(replacement.id);
  assert.equal(operation.reviewDueTick, 20);

  sim.configureLimits(store.updateLimits({ ...limits, reviewAfter: 5 }, sim.state.bio.doSetpoint));
  for (let i = 0; i < 15; i++) sim.tick();
  advisor.evaluate([], lowDo);
  assert.equal(advisor.advices[0].blocked, true);
  assert.match(advisor.execute(advisor.advices[0].id).error, /尚未到复评时间/);
  advisor.reviewOperations();
  assert.equal(advisor.operations[0].after, null);
  for (let i = 0; i < 5; i++) sim.tick();
  advisor.reviewOperations();
  assert.equal(advisor.operations[0].after.tick, 20);

  sim.reset();
  assert.equal(sim.LIMITS.reviewAfter, 5);
  assert.equal(sim.state.bio.doSetpoint, 2);
  assert.deepEqual(openManagementStore(file).data.limits, sim.LIMITS);
});
