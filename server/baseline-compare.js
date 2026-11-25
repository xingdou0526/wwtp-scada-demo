// 同随机种子基线对比：固定 DO 目标 vs 模拟人工采纳 AI 建议
import { createAdvisor } from "./advisor.js";
import { createSimulation, LIMITS } from "./simulator.js";

export const DEFAULT_COMPARE_SEED = 20261123;
const WARMUP_MINUTES = 300;
const COMPARE_MINUTES = 180;

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(1664525, value) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function simulatePolicy({ limits, seed, scenario, activeMinutes, accept }) {
  const sim = createSimulation(limits, { random: seededRandom(seed) });
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

  advance(WARMUP_MINUTES, false);
  const startEnergy = sim.state.blower.energyKwh;
  const samples = [];
  sim.setScenario(scenario, true);

  for (let i = 0; i < COMPARE_MINUTES; i++) {
    if (i === activeMinutes) sim.setScenario(scenario, false);
    advance(1);
    const proposal = advisor.activeAdvices.find((advice) => advice.type === "adjust" && !advice.blocked);
    if (accept && proposal) {
      advisor.execute(proposal.id, "基线对比模拟人工采纳");
    }
    samples.push(sim.snapshot());
  }

  const kwh = sim.state.blower.energyKwh - startEnergy;
  const minDo = Math.min(...samples.map((s) => s.do));
  const maxNh4 = Math.max(...samples.map((s) => s.effNh4));
  const overLimitMinutes = samples.filter((s) => s.effNh4 > limits.nh4InternalLimit).length;

  return {
    kwh: round2(kwh),
    minDo: round2(minDo),
    maxNh4: round2(maxNh4),
    overLimitMinutes,
    operations: advisor.operations.length,
    finalSetpoint: sim.state.bio.doSetpoint,
  };
}

export function runBaselineCompare(limits = LIMITS, seed = DEFAULT_COMPARE_SEED) {
  const cases = [
    {
      key: "night",
      title: "夜间低负荷节能",
      description: "持续 180 仿真分钟低负荷工况，验证在出水氨氮达标裕量充足时的曝气节能潜力。",
      scenario: "night",
      activeMinutes: COMPARE_MINUTES,
    },
    {
      key: "shock",
      title: "进水氨氮冲击保达标",
      description: "模拟 60 分钟高氨氮冲击并持续观测 180 仿真分钟，验证及时提曝气对抑制出水峰值与超内控时长的作用。",
      scenario: "shock",
      activeMinutes: 60,
    },
  ];

  const scenarios = cases.map(({ key, title, description, scenario, activeMinutes }) => {
    const fixed = simulatePolicy({ limits, seed, scenario, activeMinutes, accept: false });
    const assisted = simulatePolicy({ limits, seed, scenario, activeMinutes, accept: true });
    const kwhDelta = round2(assisted.kwh - fixed.kwh);
    const kwhDeltaPct = fixed.kwh > 0 ? round1((kwhDelta / fixed.kwh) * 100) : 0;
    return {
      key,
      title,
      description,
      fixed,
      assisted,
      delta: {
        kwh: kwhDelta,
        kwhPct: kwhDeltaPct,
        minDo: round2(assisted.minDo - fixed.minDo),
        maxNh4: round2(assisted.maxNh4 - fixed.maxNh4),
        overLimitMinutes: assisted.overLimitMinutes - fixed.overLimitMinutes,
      },
    };
  });

  return {
    seed,
    durationMinutes: COMPARE_MINUTES,
    nh4InternalLimit: limits.nh4InternalLimit,
    scenarios,
  };
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}
