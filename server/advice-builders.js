// 建议构造与排序辅助函数
import { KNOWLEDGE_REFS as KB } from "./management-defaults.js";

export function adviceRank(advice) {
  if (advice.kind === "inspect-sensor") return 0;
  if (advice.kind === "inspect-airflow") return 1;
  if (advice.kind === "inspect-cap" || advice.kind === "inspect-setpoint-cap") return 2;
  if (advice.type === "adjust" && !advice.blocked) return 3;
  if (advice.priority === "high") return 4;
  if (advice.type === "adjust") return 5;
  return 6;
}

export function compareAdviceIdDesc(aId, bId) {
  const num = (id) => {
    const match = /^ADV-(\d+)$/.exec(id ?? "");
    return match ? Number(match[1]) : 0;
  };
  return num(bId) - num(aId);
}

function sensorFaultLabel(faultType, quality) {
  if (faultType === "offline") return "异常（数据中断）";
  if (faultType === "stuck") return "异常（数值卡死）";
  if (faultType === "spike") return "可疑（瞬时跳变，读数异常波动）";
  if (faultType === "drift") return "可疑（探头漂移，读数持续偏离）";
  return quality === "bad" ? "异常（数据不可用）" : "测量值可疑，需核查探头与读数";
}

export function buildNh4Inspect(s, limits, { normalDo, doVal, quality }) {
  return {
    kind: "inspect-nh4",
    type: "inspect",
    priority: "high",
    title: normalDo ? "出水氨氮超内控，但 DO 正常：建议排查非曝气因素" : "出水氨氮超内控：建议核查出水数据与进水负荷",
    action: null,
    assumesNormalDo: normalDo,
    reasons: [
      { label: "出水氨氮", value: `${s.effluent.nh4.toFixed(2)} mg/L，超内控 ${limits.nh4InternalLimit} mg/L` },
      ...(normalDo ? [{ label: "好氧区 DO", value: `${doVal.toFixed(2)} mg/L，处于目标范围内` }] : []),
      { label: "水温", value: `${s.influent.temp.toFixed(0)} ℃${s.influent.temp < 15 ? "，低温抑制硝化活性" : ""}` },
    ],
    dataQuality: quality,
    constraints: [normalDo ? "DO 正常时不盲目加曝气，避免无效能耗" : "结合可靠的好氧区测量数据评估曝气需求"],
    forecast: {
      note: normalDo
        ? "建议核查水温、MLSS、污泥龄及进水毒性冲击；低温工况可通过提高 MLSS 或延长泥龄改善硝化"
        : "建议核查出水检测与进水负荷，结合生化运行数据复判",
    },
    risks: normalDo ? ["仅提高曝气对此类氨氮升高改善有限"] : [],
    knowledgeRef: KB.nitrification,
    expiresAtTick: s.tick + 60,
    reviewAfterTick: s.tick + 60,
  };
}

export function buildSensorInspect(s, quality) {
  const faultType = s.measured.doFaultType ??
    (s.fault.doOffline ? "offline" : s.fault.doStuck ? "stuck" : s.fault.doSpike ? "spike" : s.fault.doDrift ? "drift" : null);
  return {
    kind: "inspect-sensor",
    type: "inspect",
    priority: "high",
    title: quality === "bad" || faultType === "offline" || faultType === "stuck"
      ? "DO 仪表数据不可用，建议现场排查"
      : "DO 仪表数据不可信，建议现场核查",
    action: null,
    reasons: [
      { label: "DO 数据质量", value: sensorFaultLabel(faultType, quality) },
      { label: "当前风量", value: `${s.bio.airflow.toFixed(0)} m³/h，保持现有联动运行` },
    ],
    dataQuality: quality,
    constraints: ["数据不可信期间禁止输出曝气调节建议"],
    forecast: { note: "恢复可靠测量前，建议维持当前 DO 目标值，依托现场自动联动运行" },
    risks: ["盲目依据异常数据调节可能导致过曝气或供氧不足"],
    knowledgeRef: KB.sensor,
    expiresAtTick: s.tick + 60,
    reviewAfterTick: s.tick + 30,
  };
}

export function buildAirflowInspect(s) {
  return {
    kind: "inspect-airflow",
    type: "inspect",
    priority: "high",
    title: "风量反馈异常，建议先核查仪表与联动信号",
    action: null,
    reasons: [
      { label: "反馈风量", value: `${s.measured.airflow.toFixed(0)} m³/h，数据质量异常` },
    ],
    dataQuality: "bad",
    constraints: ["风量数据不可信期间暂停曝气调节建议"],
    forecast: { note: "核实反馈信号后重新评估当前供氧状态" },
    risks: [],
    knowledgeRef: KB.sensor,
    expiresAtTick: s.tick + 60,
    reviewAfterTick: s.tick + 30,
  };
}

export function buildAirflowCapInspect(s, doVal, quality) {
  return {
    kind: "inspect-cap",
    type: "inspect",
    priority: "high",
    title: "风量已接近上限，建议核查供氧能力",
    action: null,
    reasons: [
      { label: "好氧区 DO", value: `${doVal.toFixed(2)} mg/L（目标 ${s.bio.doSetpoint.toFixed(1)}）` },
      { label: "当前风量", value: `${s.bio.airflow.toFixed(0)} m³/h，已达上限 95% 以上` },
    ],
    dataQuality: quality,
    constraints: ["风量接近上限时不再上调 DO 目标"],
    forecast: { note: "继续上调目标无法有效提升 DO，需检查风机台数、曝气器堵塞或负荷分配" },
    risks: ["长期低 DO 可能导致硝化不足、出水氨氮升高"],
    knowledgeRef: KB.aeration,
    expiresAtTick: s.tick + 60,
    reviewAfterTick: s.tick + 30,
  };
}

export function buildSetpointCapInspect(s, limits, doWin, quality) {
  return {
    kind: "inspect-setpoint-cap",
    type: "inspect",
    priority: "high",
    title: "DO 目标已达上限，但好氧区 DO 仍持续偏低：建议核查供氧与负荷",
    action: null,
    reasons: [
      { label: "好氧区 DO", value: `近 10 分钟均值 ${doWin.avg.toFixed(2)} mg/L，低于目标 ${s.bio.doSetpoint.toFixed(1)} mg/L` },
      { label: "DO 目标上限", value: `当前已达规则上限 ${limits.doSetpointMax.toFixed(1)} mg/L` },
      { label: "当前风量", value: `${s.bio.airflow.toFixed(0)} m³/h（上限 ${limits.airflowMax} m³/h）` },
    ],
    dataQuality: quality,
    constraints: [`DO 目标值不得超过允许上限 ${limits.doSetpointMax.toFixed(1)} mg/L`],
    forecast: { note: "建议核查进水高负荷冲击、联动 PID 响应滞后或鼓风曝气设备效率" },
    risks: ["长期低 DO 可能导致硝化不足、出水氨氮升高"],
    knowledgeRef: KB.aeration,
    expiresAtTick: s.tick + 60,
    reviewAfterTick: s.tick + 30,
  };
}

export function buildRaiseAdvice(s, limits, { doWin, to, quality, restriction, observation }) {
  return {
    kind: "raise",
    type: "adjust",
    priority: "high",
    title: "建议提高曝气：上调好氧区 DO 目标值",
    action: { param: "doSetpoint", from: s.bio.doSetpoint, to },
    reasons: [
      { label: "好氧区 DO", value: `近 10 分钟均值 ${doWin.avg.toFixed(2)} mg/L，低于目标 ${s.bio.doSetpoint.toFixed(1)} mg/L` },
      { label: "进水负荷", value: `流量 ${s.influent.flow.toFixed(0)} m³/h，进水氨氮 ${s.influent.nh4.toFixed(1)} mg/L` },
      ...(observation ? [{ label: "此前负荷观察", value: observation.reasons[0].value }] : []),
      { label: "出水氨氮", value: `${s.effluent.nh4.toFixed(2)} mg/L（内控 ${limits.nh4InternalLimit} mg/L）` },
    ],
    dataQuality: quality,
    constraints: [
      restriction || "已满足最小调节间隔与复评约束",
      `调整后目标 ${to.toFixed(1)} mg/L，处于 ${limits.doSetpointMin}~${limits.doSetpointMax} 允许范围`,
      `单次步长 ${limits.doSetpointStep} mg/L，由现有联动系统自动增加风量`,
    ],
    blocked: Boolean(restriction),
    forecast: {
      doRange: `${(to - 0.2).toFixed(1)} ~ ${(to + 0.2).toFixed(1)} mg/L`,
      responseMinutes: "30~45 分钟逐步趋稳",
      nh4Trend: "有助于维持硝化能力，抑制出水氨氮上升风险",
      energyDeltaPct: "+6% ~ +12%（风机电耗，随实际风量变化）",
    },
    risks: ["曝气增加将带来电耗上升", "若 DO 持续不回升，需排查曝气器或风量反馈"],
    knowledgeRef: KB.aeration,
    expiresAtTick: s.tick + 15,
    reviewAfterTick: s.tick + limits.reviewAfter,
  };
}

export function buildLowerAdvice(s, limits, { doHighWin, to, quality, restriction }) {
  return {
    kind: "lower",
    type: "adjust",
    priority: "medium",
    title: "建议降低曝气：低负荷工况节能运行",
    action: { param: "doSetpoint", from: s.bio.doSetpoint, to },
    reasons: [
      { label: "好氧区 DO", value: `近 15 分钟均值 ${doHighWin.avg.toFixed(2)} mg/L，明显高于目标 ${s.bio.doSetpoint.toFixed(1)} mg/L` },
      { label: "负荷水平", value: `进水流量 ${s.influent.flow.toFixed(0)} m³/h，处于低负荷工况` },
      { label: "出水氨氮", value: `${s.effluent.nh4.toFixed(2)} mg/L，达标裕量充足` },
    ],
    dataQuality: quality,
    constraints: [
      restriction || "已满足最小调节间隔与复评约束",
      `调整后目标 ${to.toFixed(1)} mg/L，不低于下限 ${limits.doSetpointMin} mg/L`,
    ],
    blocked: Boolean(restriction),
    forecast: {
      doRange: `${(to - 0.2).toFixed(1)} ~ ${(to + 0.2).toFixed(1)} mg/L`,
      responseMinutes: "20~40 分钟逐步趋稳",
      nh4Trend: "预计出水氨氮维持当前水平，需执行后持续观察",
      energyDeltaPct: "-8% ~ -15%（风机电耗）",
    },
    risks: ["若负荷突然回升，需及时恢复 DO 目标", "下调后需关注出水氨氮变化"],
    knowledgeRef: KB.energy,
    expiresAtTick: s.tick + 15,
    reviewAfterTick: s.tick + limits.reviewAfter,
  };
}

export function buildObserveAdvice(s, { flowRising, flowWin, nh4Win, doVal, quality }) {
  return {
    kind: "observe",
    type: "observe",
    priority: "low",
    title: "进水负荷上升，建议密切关注 DO 变化",
    action: null,
    reasons: [
      flowRising
        ? { label: "进水流量", value: `近 1 小时由 ${flowWin.first.toFixed(0)} 升至 ${flowWin.last.toFixed(0)} m³/h（+15% 以上）` }
        : { label: "进水氨氮", value: `近 1 小时由 ${nh4Win.first.toFixed(1)} 升至 ${nh4Win.last.toFixed(1)} mg/L（+20% 以上）` },
      { label: "当前 DO", value: `${doVal.toFixed(2)} mg/L，暂在目标范围内` },
    ],
    dataQuality: quality,
    constraints: ["DO 未跌破阈值前不提前调节，避免过曝气"],
    forecast: { note: "需氧量将随负荷上升，若 DO 持续回落将生成提高曝气建议" },
    risks: [],
    knowledgeRef: KB.aeration,
    expiresAtTick: s.tick + 30,
    reviewAfterTick: s.tick + 30,
  };
}

export function buildMonitorStatus(s, limits, {
  doWin,
  doHighWin,
  loadRising,
  pendingReviewTicks,
  raiseCooldown,
  lowerCooldown,
}) {
  const doVal = s.measured.do;
  const quality = s.measured.doQuality;
  const setpoint = s.bio.doSetpoint;

  if (doVal !== null && quality === "good") {
    const lowInstant = doVal < setpoint - 0.35;
    const lowAvg = Boolean(doWin && doWin.avg < setpoint - 0.35);
    if (lowInstant) {
      if (lowAvg && raiseCooldown > 0) {
        return {
          level: "warning",
          title: `DO 偏低，同类建议冷却中（剩余约 ${raiseCooldown} 仿真分钟）`,
          detail: `当前 DO ${doVal.toFixed(2)} mg/L（目标 ${setpoint.toFixed(1)} mg/L），为避免短时重复弹窗，冷却结束后将重新评估是否上调。`,
        };
      }
      if (!lowAvg) {
        const avgText = doWin ? `近 10 分钟均值 ${doWin.avg.toFixed(2)} mg/L` : "正在累计趋势窗口";
        return {
          level: "warning",
          title: "已监测到 DO 偏低，正在确认 10 分钟趋势",
          detail: `当前瞬时 DO ${doVal.toFixed(2)} mg/L（目标 ${setpoint.toFixed(1)} mg/L），${avgText}；确认持续偏低后将生成提高曝气建议。`,
        };
      }
    }

    if (pendingReviewTicks > 0) {
      return {
        level: "info",
        title: `已执行调节，等待自动复评（剩余约 ${pendingReviewTicks} 仿真分钟）`,
        detail: "上次 DO 目标调节正在观察生效过程，复评完成前暂不连续下发新调节动作。",
      };
    }

    const highInstant = doVal > setpoint + 0.35;
    const highAvg = Boolean(doHighWin && doHighWin.avg > setpoint + 0.7);
    if (highInstant) {
      const lowLoad = s.scenario.night || s.influent.flow < 700;
      const nh4Safe = s.effluent.nh4 < Math.min(0.5, limits.nh4InternalLimit);
      if (!lowLoad || !nh4Safe || s.scenario.shock || s.scenario.storm || loadRising) {
        return {
          level: "info",
          title: "已监测到 DO 偏高，暂不触发节能下调",
          detail: `当前 DO ${doVal.toFixed(2)} mg/L 高于目标 ${setpoint.toFixed(1)} mg/L，但当前负荷或水质裕量未满足节能条件，等待联动系统自然回稳。`,
        };
      }
      if (!highAvg) {
        const avgText = doHighWin ? `近 15 分钟均值 ${doHighWin.avg.toFixed(2)} mg/L` : "正在累计趋势窗口";
        return {
          level: "info",
          title: "DO 偏高，正在确认 15 分钟稳定趋势",
          detail: `当前瞬时 DO ${doVal.toFixed(2)} mg/L，${avgText}；持续高于阈值且负荷平稳后将评估节能下调。`,
        };
      }
      if (setpoint <= limits.doSetpointMin + 1e-9) {
        return {
          level: "info",
          title: "DO 偏高，目标值已处于允许下限",
          detail: `当前 DO 目标值已为下限 ${limits.doSetpointMin.toFixed(1)} mg/L，维持现有自动联动运行。`,
        };
      }
      if (lowerCooldown > 0) {
        return {
          level: "info",
          title: `DO 偏高，节能建议冷却中（剩余约 ${lowerCooldown} 仿真分钟）`,
          detail: "距上次节能下调建议未满冷却期，期间暂不重复提示。",
        };
      }
    }
  }

  if (pendingReviewTicks > 0) {
    return {
      level: "info",
      title: `已执行调节，等待自动复评（剩余约 ${pendingReviewTicks} 仿真分钟）`,
      detail: "上次调节正在观察生效过程，到期后将自动采样并回填复评结果。",
    };
  }

  return {
    level: "normal",
    title: "暂无待处理建议",
    detail: "我会持续监测 DO、进水负荷与出水氨氮。出现持续异常时，将在此给出调节建议、判断依据和预计效果。",
  };
}
