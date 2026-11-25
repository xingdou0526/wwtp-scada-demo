export const STATUS_LABELS = {
  executed: "已执行",
  ignored: "主动忽略",
  expired: "到期未处理",
  invalidated: "已失效",
  interrupted: "已中断",
  superseded: "已升级",
} as const;

export const END_REASONS: Record<string, string> = {
  conditions: "工况或测量数据质量发生变化",
  limits: "规则参数已更新",
  reset: "仿真已复位",
  restart: "服务已重启",
  upgraded: "同一工艺问题已生成更高优先级的建议",
};

export const ADVICE_TYPES: Record<string, string> = {
  adjust: "调节建议",
  inspect: "排查建议",
  observe: "观察提示",
};

export const PRIORITY_LABELS: Record<string, string> = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级",
};

export type HistoryStatus = keyof typeof STATUS_LABELS;

export interface AdviceHistoryRecord {
  id: string;
  title: string;
  status: HistoryStatus;
  type: string;
  priority?: string | null;
  createdAt?: string | null;
  endedAt?: string | null;
  createdTick?: number | null;
  endedTick?: number | null;
  createdClockMinutes?: number | null;
  endedClockMinutes?: number | null;
  endReason?: string | null;
  invalidatedBy?: string | null;
  supersededBy?: string | null;
  action?: { from: number; to: number } | null;
  reasons?: { label: string; value: string }[];
  constraints?: string[];
  risks?: string[];
  forecast?: {
    note?: string;
    doRange?: string;
    responseMinutes?: string;
    nh4Trend?: string;
    energyDeltaPct?: string;
  };
  knowledgeRef?: string | null;
  operationId?: string | null;
}
