export const DO_ADJUSTMENT = {
  stageId: "biological",
  stageName: "生化池",
  nodeId: "biological-stage",
  panelId: "biological-adjustment",
  label: "好氧区 DO 目标值",
  buttonLabel: "调节 DO",
};

export interface DoAdjustmentAdvice {
  id: string;
  from: number;
  to: number;
  reviewMinutes: number;
}

export interface ActiveAdvice {
  id: string;
  title: string;
  type: "adjust" | "inspect" | "observe";
  priority: "high" | "medium" | "low";
  status: "pending";
  createdTick: number;
  expiresAtTick: number;
  reviewAfterTick: number;
  remainingSeconds: number;
  action: { param: string; from: number; to: number } | null;
  blocked?: boolean;
  reasons: { label: string; value: string }[];
  forecast: {
    doRange?: string;
    responseMinutes?: string;
    nh4Trend?: string;
    energyDeltaPct?: string;
    note?: string;
  };
  constraints: string[];
  risks: string[];
  knowledgeRef?: string;
}
