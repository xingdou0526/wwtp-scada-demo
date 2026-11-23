// 工艺仿真引擎：1 tick = 1 仿真分钟，按因果关系演化各环节数据
export const LIMITS = {
  doSetpointMin: 1.5,
  doSetpointMax: 3.0,
  doSetpointStep: 0.2,
  airflowMin: 400,
  airflowMax: 2000,
  nh4InternalLimit: 1.0,
  minExecuteInterval: 30, // tick
  reviewAfter: 30, // tick
};

const BASE = { flow: 950, cod: 118, nh4: 25, temp: 25 };

function noise(amp) {
  return (Math.random() - 0.5) * 2 * amp;
}

// 进水日曲线：早晚高峰、夜间低谷
function diurnal(hour) {
  const morning = Math.exp(-Math.pow(hour - 9, 2) / 8);
  const evening = Math.exp(-Math.pow(hour - 19, 2) / 10);
  const night = Math.exp(-Math.pow(hour - 3, 2) / 12);
  return 0.85 + 0.25 * morning + 0.2 * evening - 0.25 * night;
}

export function createSimulation() {
  const state = {
    tick: 0,
    clockMinutes: 8 * 60, // 仿真时间从 08:00 开始
    scenario: { storm: false, winter: false, summer: false, night: false, shock: false },
    fault: { doDrift: false, doStuck: false, doSpike: false, doOffline: false },
    influent: { flow: BASE.flow, cod: BASE.cod, nh4: BASE.nh4, temp: BASE.temp },
    bio: { do: 2.0, doSetpoint: 2.0, mlss: 10000, airflow: 1100, airflowDemand: 1100, our: 0 },
    measured: { do: 2.0, doQuality: "good", doFaultType: null },
    membrane: { tmp: 18, flux: 15 },
    effluent: { nh4: 0.3, cod: 9, tn: 11.5, tp: 0.2 },
    blower: { power: 55, energyKwh: 0, pressure: 68, current: 95, running: true },
    lastExecuteTick: -999,
  };

  let driftAccum = 0;
  let stuckValue = null;

  function updateInfluent() {
    const s = state.scenario;
    const hour = (state.clockMinutes / 60) % 24;
    const curve = diurnal(hour);
    let flow = BASE.flow * curve;
    let cod = BASE.cod * curve;
    let nh4 = BASE.nh4 * (0.9 + 0.1 * curve);
    let temp = BASE.temp;

    if (s.night) { flow *= 0.6; cod *= 0.85; nh4 *= 0.85; }
    if (s.storm) { flow *= 1.4; cod *= 0.8; nh4 *= 0.8; }
    if (s.shock) { nh4 *= 1.5; }
    if (s.winter) temp = 12;
    else if (s.summer) temp = 28;

    state.influent = {
      flow: Math.max(100, flow + noise(15)),
      cod: Math.max(20, cod + noise(3)),
      nh4: Math.max(5, nh4 + noise(0.6)),
      temp,
    };
  }

  function updateBio() {
    const { influent: inf, bio } = state;
    // 需氧量 kgO2/h = 有机物氧化 + 硝化耗氧
    const our = (inf.flow * (0.35 * inf.cod + 4.0 * inf.nh4)) / 1000;
    bio.our = our;

    // 自动联动：根据 DO 偏差调节风量需求（模拟现场已有 PID，存在响应滞后）
    const err = bio.doSetpoint - bio.do;
    bio.airflowDemand = clamp(bio.airflowDemand + err * 2.5, LIMITS.airflowMin, LIMITS.airflowMax);
    // 风量一阶追踪（时间常数约 3 分钟）
    bio.airflow += (bio.airflowDemand - bio.airflow) * 0.3;

    // 供氧与 DO 平衡：供氧超出需氧越多，DO 平衡值越高
    const oxySupply = bio.airflow * 0.16 * (inf.temp >= 28 ? 0.92 : 1); // 夏季氧转移效率略降
    const doEquilibrium = clamp(1.0 + ((oxySupply - our) / our) * 6, 0, 8);
    // DO 一阶响应（时间常数约 15 分钟）
    bio.do += (doEquilibrium - bio.do) * 0.065;
    bio.do = Math.max(0, bio.do);
  }

  function updateEffluent() {
    const { bio, influent: inf, effluent } = state;
    // 硝化能力：DO 的 Monod 关系 + 水温影响
    const doFactor = bio.do / (0.6 + bio.do);
    const tempFactor = Math.exp(0.08 * (inf.temp - 20));
    const capacity = doFactor * tempFactor;
    const loadRatio = (inf.nh4 * inf.flow) / (BASE.nh4 * BASE.flow) / Math.max(0.15, capacity);
    // 出水氨氮平衡值：负荷相对硝化能力越高，出水越高
    const nh4Equil = clamp(0.05 + Math.pow(Math.max(0, loadRatio - 0.55), 2) * 4, 0.02, 10);
    // 出水响应滞后（时间常数约 90 分钟）
    effluent.nh4 += (nh4Equil - effluent.nh4) * 0.011;
    effluent.cod += (8 + inf.cod * 0.01 - effluent.cod) * 0.02;
    effluent.tn += (10 + inf.nh4 * 0.08 - effluent.tn) * 0.02;
    effluent.tp = Math.max(0.05, 0.2 + noise(0.01));
  }

  function updateBlower() {
    const { bio, blower } = state;
    blower.power = 55 * Math.pow(bio.airflow / 1100, 3);
    blower.energyKwh += blower.power / 60;
    blower.pressure = 68 + noise(0.5);
    blower.current = 95 * (blower.power / 55) + noise(1);
  }

  function updateMembrane() {
    state.membrane.tmp = clamp(state.membrane.tmp + noise(0.05) + 0.002, 12, 35);
    state.membrane.flux = clamp(15 + noise(0.3), 10, 20);
  }

  function updateMeasurement() {
    const { bio, measured, fault } = state;
    let value = bio.do + noise(0.02);
    let quality = "good";
    let faultType = null;

    if (fault.doDrift) {
      driftAccum = Math.min(driftAccum + 0.004, 0.9);
      value -= driftAccum;
      quality = "suspect";
      faultType = "drift";
    } else {
      driftAccum = 0;
    }
    if (fault.doStuck) {
      if (stuckValue === null) stuckValue = bio.do;
      value = stuckValue;
      quality = "bad";
      faultType = "stuck";
    } else {
      stuckValue = null;
    }
    if (fault.doSpike && state.tick % 25 === 0) {
      value += 1.5;
      quality = "suspect";
      faultType = "spike";
    }
    if (fault.doOffline) {
      value = null;
      quality = "bad";
      faultType = "offline";
    }

    measured.do = value === null ? null : Math.max(0, value);
    measured.doQuality = quality;
    measured.doFaultType = faultType;
  }

  function tick() {
    state.tick += 1;
    state.clockMinutes += 1;
    updateInfluent();
    updateBio();
    updateEffluent();
    updateBlower();
    updateMembrane();
    updateMeasurement();
  }

  function setScenario(key, enabled) {
    if (!(key in state.scenario)) return false;
    if (key === "winter" && enabled) state.scenario.summer = false;
    if (key === "summer" && enabled) state.scenario.winter = false;
    state.scenario[key] = enabled;
    return true;
  }

  function injectFault(type, enabled) {
    if (!(type in state.fault)) return false;
    state.fault[type] = enabled;
    return true;
  }

  function reset() {
    const fresh = createSimulation();
    Object.keys(state).forEach((k) => { state[k] = fresh.state[k]; });
    driftAccum = 0;
    stuckValue = null;
  }

  function snapshot() {
    return {
      tick: state.tick,
      clockMinutes: state.clockMinutes,
      do: state.bio.do,
      doSetpoint: state.bio.doSetpoint,
      airflow: state.bio.airflow,
      power: state.blower.power,
      effNh4: state.effluent.nh4,
      flow: state.influent.flow,
      infNh4: state.influent.nh4,
      temp: state.influent.temp,
    };
  }

  return { state, tick, setScenario, injectFault, reset, snapshot, LIMITS };
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
