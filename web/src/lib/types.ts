import type { ActiveAdvice } from "@/lib/advice";
import type { RuleLimits } from "@/lib/admin";
import type { Term } from "@/lib/terms";

export type Quality = "good" | "suspect" | "bad";
export type DoFaultType = "drift" | "stuck" | "spike" | "offline" | null;
export type PresetKey = "shock" | "night" | "fault";

export interface ScenarioState {
  storm: boolean;
  winter: boolean;
  summer: boolean;
  night: boolean;
  shock: boolean;
}

export interface FaultState {
  doDrift: boolean;
  doStuck: boolean;
  doSpike: boolean;
  doOffline: boolean;
  airflowFeedback: boolean;
}

export interface SimState {
  tick: number;
  clockMinutes: number;
  scenario: ScenarioState;
  fault: FaultState;
  influent: { flow: number; cod: number; nh4: number; temp: number };
  bio: { do: number; doSetpoint: number; mlss: number; airflow: number; airflowDemand: number; our: number };
  measured: { do: number | null; doQuality: Quality; doFaultType: DoFaultType; airflow: number; airflowQuality: Quality };
  membrane: { tmp: number; flux: number };
  effluent: { nh4: number; cod: number; tn: number; tp: number };
  blower: { power: number; energyKwh: number; pressure: number; current: number; running: boolean };
  lastExecuteTick: number;
}

export interface HistoryPoint {
  tick: number;
  clockMinutes: number;
  do: number;
  measuredDo: number | null;
  doSetpoint: number;
  airflow: number;
  measuredAirflow: number;
  tmp: number;
  power: number;
  effNh4: number;
  flow: number;
  infNh4: number;
  temp: number;
}

export interface ExecutionMarker {
  id: string;
  tick: number;
  from: number;
  to: number;
}

export interface MonitorStatus {
  level: "normal" | "info" | "warning";
  title: string;
  detail: string;
}

export interface StateResponse {
  state: SimState;
  limits: RuleLimits;
  terms: Term[];
  history: HistoryPoint[];
  markers?: ExecutionMarker[];
  activePreset?: PresetKey | null;
  activeAdvice: ActiveAdvice | null;
  activeAdvices: ActiveAdvice[];
  monitorStatus?: MonitorStatus;
  timing: {
    secondsPerTick: number;
    adviceRemainingSeconds: number;
    paused?: boolean;
  };
}

export interface PolicyMetrics {
  kwh: number;
  minDo: number;
  maxNh4: number;
  overLimitMinutes: number;
  operations: number;
  finalSetpoint: number;
}

export interface CompareScenario {
  key: string;
  title: string;
  description: string;
  fixed: PolicyMetrics;
  assisted: PolicyMetrics;
  delta: {
    kwh: number;
    kwhPct: number;
    minDo: number;
    maxNh4: number;
    overLimitMinutes: number;
  };
}

export interface CompareResponse {
  seed: number;
  durationMinutes: number;
  nh4InternalLimit: number;
  scenarios: CompareScenario[];
}
