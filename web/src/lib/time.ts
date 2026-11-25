export const APP_TIME_ZONE = "Asia/Shanghai";

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: APP_TIME_ZONE,
  dateStyle: "short",
  timeStyle: "medium",
});

const calendarDayFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function formatDateTime(value: string | Date) {
  return dateTimeFormatter.format(typeof value === "string" ? new Date(value) : value);
}

export function formatCalendarDay(value: string | Date) {
  return calendarDayFormatter.format(typeof value === "string" ? new Date(value) : value);
}

export function formatClock(minutes: number) {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function formatTick(tick: number) {
  return `T+${tick} min`;
}
