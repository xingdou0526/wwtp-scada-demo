import assert from "node:assert/strict";
import { test } from "node:test";
import { createAdvisor } from "./advisor.js";
import { createSimulation, LIMITS } from "./simulator.js";

const SEED = 20261123;

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(1664525, value) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function fixture(limits = LIMITS) {
  const sim = createSimulation(limits, { random: seededRandom(SEED) });
  const advisor = createAdvisor(sim);
  const history = [];
  const measured = [];
  function advance(minutes, evaluate = true) {
    for (let i = 0; i < minutes; i++) {
      sim.tick();
      history.push(sim.snapshot());
      measured.push({ do: sim.state.measured.do });
      if (history.length > 240) {
        history.shift();
        measured.shift();
      }
      if (evaluate) advisor.evaluate(history, measured);
      advisor.reviewOperations();
    }
  }
  const pending = () => advisor.advices.find((advice) => advice.status === "pending");
  return { sim, advisor, advance, pending };
}

function lowDoAdvice({ sim, advisor, pending }) {
  sim.state.bio.do = 1.1;
  sim.state.measured.do = 1.1;
  advisor.evaluate([], Array.from({ length: 10 }, () => ({ do: 1.1 })));
  const advice = pending();
  assert.equal(advice?.kind, "raise");
  return advice;
}

test("01 正常稳态保持固定 DO，出水氨氮低于内控", () => {
  const run = fixture();
  run.advance(360, false);
  for (let i = 0; i < 30; i++) {
    run.advance(1);
    assert.ok(Math.abs(run.sim.state.bio.do - 2.0) < 0.5);
    assert.ok(run.sim.state.effluent.nh4 < LIMITS.nh4InternalLimit);
    assert.equal(run.sim.state.bio.doSetpoint, 2.0);
    assert.notEqual(run.pending()?.type, "adjust");
  }
});

test("02 进水冲击提高负荷并撤回待执行的节能建议", () => {
  const run = fixture();
  run.advance(300, false);
  const before = run.sim.state.influent.nh4;
  run.sim.setScenario("shock", true);
  run.advance(65);
  assert.ok(run.sim.state.influent.nh4 > before * 1.3);
  assert.ok(run.advisor.advices.some(({ kind }) => kind === "raise"));
  assert.ok(run.advisor.advices.every(({ kind }) => kind !== "lower"));

  const night = fixture();
  night.advance(300, false);
  night.sim.setScenario("night", true);
  for (let i = 0; i < 100 && night.pending()?.kind !== "lower"; i++) night.advance(1);
  const lower = night.pending();
  assert.equal(lower?.kind, "lower");
  night.sim.setScenario("storm", true);
  assert.match(night.advisor.execute(lower.id).error, /节能调节条件/);
  assert.equal(night.sim.state.bio.doSetpoint, 2);
  night.advance(1);
  assert.equal(lower.invalidatedBy, "conditions");
});

test("03 夜间低负荷允许在有出水裕量时下调目标", () => {
  const run = fixture();
  run.advance(300, false);
  const before = run.sim.state.influent.flow;
  run.sim.setScenario("night", true);
  for (let i = 0; i < 100 && run.pending()?.kind !== "lower"; i++) run.advance(1);
  const advice = run.pending();
  assert.equal(advice?.kind, "lower");
  assert.ok(run.sim.state.influent.flow < before * 0.75);
  assert.ok(run.sim.state.effluent.nh4 < LIMITS.nh4InternalLimit);
  assert.ok(run.advisor.execute(advice.id).ok);
  assert.equal(run.sim.state.bio.doSetpoint, 1.8);
});

test("04 真实 DO 偏低时建议上调，接近风量上限时只排查", () => {
  const run = fixture();
  const advice = lowDoAdvice(run);
  assert.equal(advice.action.to, 2.2);
  run.sim.state.bio.airflow = LIMITS.airflowMax * 0.96;
  assert.match(run.advisor.execute(advice.id).error, /接近上限/);
  run.advisor.evaluate([], Array.from({ length: 10 }, () => ({ do: 1.1 })));
  assert.equal(run.pending()?.kind, "inspect-cap");
  assert.equal(run.pending()?.action, null);
});

test("05 DO 探头漂移标为可疑，并阻止待执行调节", () => {
  const run = fixture();
  const advice = lowDoAdvice(run);
  run.sim.injectFault("doDrift", true);
  assert.match(run.advisor.execute(advice.id).error, /DO 测量数据不可信/);
  run.advance(12);
  assert.equal(run.sim.state.measured.doQuality, "suspect");
  assert.notEqual(run.pending()?.type, "adjust");
  assert.equal(run.sim.state.bio.doSetpoint, 2);
});

test("06 DO 卡值和中断都只给出仪表排查建议", () => {
  for (const fault of ["doStuck", "doOffline"]) {
    const run = fixture();
    const stale = lowDoAdvice(run);
    run.sim.injectFault(fault, true);
    run.advance(2);
    assert.equal(run.sim.state.measured.doQuality, "bad");
    assert.equal(stale.invalidatedBy, "conditions");
    assert.equal(run.pending()?.kind, "inspect-sensor");
    assert.equal(run.pending()?.action, null);
    if (fault === "doOffline") assert.equal(run.sim.state.measured.do, null);
    else assert.equal(run.sim.state.measured.doFaultType, "stuck");
  }
});

test("07 风量反馈异常与仿真真值分离，撤回待执行调节", () => {
  const run = fixture();
  const advice = lowDoAdvice(run);
  run.sim.injectFault("airflowFeedback", true);
  assert.match(run.advisor.execute(advice.id).error, /风量反馈不可信/);
  run.advance(1);
  assert.equal(run.sim.state.measured.airflowQuality, "bad");
  assert.ok(run.sim.state.measured.airflow < run.sim.state.bio.airflow);
  assert.equal(run.pending()?.kind, "inspect-airflow");
  assert.equal(run.pending()?.action, null);
  run.sim.injectFault("airflowFeedback", false);
  run.advance(1);
  assert.equal(run.sim.state.measured.airflow, run.sim.state.bio.airflow);
  assert.equal(run.sim.state.measured.airflowQuality, "good");
});

test("08 DO 正常且氨氮超内控时排查非曝气因素", () => {
  const run = fixture();
  run.sim.state.effluent.nh4 = 1.3;
  run.advisor.evaluate([], [{ do: 2.0 }]);
  assert.equal(run.pending()?.kind, "inspect-nh4");
  assert.equal(run.pending()?.action, null);
});

test("09 忽略建议不改变目标值，也不创建执行记录", () => {
  const run = fixture();
  const advice = lowDoAdvice(run);
  assert.ok(run.advisor.ignore(advice.id).ok);
  assert.equal(run.advisor.execute(advice.id).ok, false);
  run.advance(20);
  assert.equal(run.sim.state.bio.doSetpoint, 2);
  assert.equal(run.advisor.operations.length, 0);
});

test("10 复评前不允许连续调节，即使最小间隔已经结束", () => {
  const run = fixture({ ...LIMITS, minExecuteInterval: 1, reviewAfter: 20 });
  const advice = lowDoAdvice(run);
  assert.ok(run.advisor.execute(advice.id).ok);
  run.advance(15, false);
  const next = lowDoAdvice(run);
  assert.match(run.advisor.execute(next.id).error, /尚未到复评时间/);
  assert.equal(run.sim.state.bio.doSetpoint, 2.2);
  assert.equal(run.advisor.operations[0].after, null);
  run.advance(5, false);
  assert.equal(run.advisor.operations[0].after.tick, 20);
});

function comparePolicy(scenario, activeMinutes, accept) {
  const run = fixture();
  run.advance(300, false);
  const startEnergy = run.sim.state.blower.energyKwh;
  const samples = [];
  const influent = [];
  run.sim.setScenario(scenario, true);
  for (let i = 0; i < 180; i++) {
    if (i === activeMinutes) run.sim.setScenario(scenario, false);
    run.advance(1);
    const proposal = run.pending();
    if (accept && proposal?.type === "adjust" && !proposal.blocked) {
      assert.ok(run.advisor.execute(proposal.id, "基线对比模拟人工采纳").ok);
    }
    if (!accept) assert.equal(run.sim.state.bio.doSetpoint, 2.0);
    influent.push(run.sim.state.influent);
    samples.push(run.sim.snapshot());
  }
  return {
    influent,
    kwh: run.sim.state.blower.energyKwh - startEnergy,
    minDo: Math.min(...samples.map((s) => s.do)),
    maxNh4: Math.max(...samples.map((s) => s.effNh4)),
    overLimit: samples.filter((s) => s.effNh4 > LIMITS.nh4InternalLimit).length,
    operations: run.advisor.operations.length,
  };
}

test("同随机种子对比固定目标与人工采纳建议", () => {
  const results = [];
  for (const [scenario, minutes, label] of [["night", 180, "夜间低负荷"], ["shock", 60, "进水冲击 60 分钟"]]) {
    const fixed = comparePolicy(scenario, minutes, false);
    const accepted = comparePolicy(scenario, minutes, true);
    assert.deepEqual(accepted.influent, fixed.influent);
    assert.equal(fixed.operations, 0);
    assert.ok(accepted.operations > 0);
    for (const [policy, reading] of [["固定目标", fixed], ["模拟人工采纳", accepted]]) {
      results.push({
        工况: label, 策略: policy, "电耗 kWh": reading.kwh.toFixed(2),
        "最低 DO mg/L": reading.minDo.toFixed(2), "峰值氨氮 mg/L": reading.maxNh4.toFixed(2),
        超内控分钟: reading.overLimit, 执行次数: reading.operations,
      });
    }
  }
  console.log("每组 180 仿真分钟，种子 " + SEED);
  console.table(results);
});
