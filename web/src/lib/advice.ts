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
