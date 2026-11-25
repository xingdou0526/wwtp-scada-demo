import { lazy, Suspense, useRef, useState, type ComponentProps } from "react";
import type { DateRange } from "@daypicker/react";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { APP_TIME_ZONE, formatCalendarDay } from "@/lib/time";
import { cn } from "@/lib/utils";

const HistoryCalendar = lazy(async () => {
  const [{ Calendar }, { zhCN }] = await Promise.all([
    import("@/components/ui/calendar"),
    import("@daypicker/react/locale/zh-CN"),
  ]);
  return {
    default: (props: ComponentProps<typeof Calendar>) => (
      <Calendar {...props} locale={zhCN} timeZone={APP_TIME_ZONE} />
    ),
  };
});

export function HistoryDateFilter({ id, range, onChange }: {
  id: string;
  range: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange>();
  const trigger = useRef<HTMLButtonElement>(null);
  const from = range?.from ? formatCalendarDay(range.from) : "";
  const to = range?.to ? formatCalendarDay(range.to) : "";
  const summary = from && to && from !== to ? `${from} 至 ${to}` : from;

  function applyRange(next: DateRange | undefined) {
    onChange(next);
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="block text-xs">日期范围</Label>
      <Popover open={open} onOpenChange={(nextOpen) => {
        if (nextOpen) setDraft(range);
        setOpen(nextOpen);
      }}>
        <PopoverTrigger asChild>
          <Button ref={trigger} id={id} type="button" variant="outline" className="w-full justify-start gap-2 bg-card px-2.5 text-left text-xs font-normal tabular-nums">
            <CalendarDays aria-hidden className="text-muted-foreground" />
            <span className={cn(!summary && "text-muted-foreground")}>{summary || "全部日期"}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} collisionPadding={8} aria-label="选择日期范围"
          className="w-auto max-h-(--radix-popover-content-available-height) overflow-y-auto rounded-lg p-3">
          <Suspense fallback={<p role="status" className="grid h-64 w-63 place-items-center text-sm text-muted-foreground">正在加载日历…</p>}>
            <HistoryCalendar
              className="[--cell-size:--spacing(9)]"
              mode="range"
              resetOnSelect
              defaultMonth={range?.from}
              selected={draft}
              onSelect={setDraft}
            />
          </Suspense>
          <div className="mt-2 flex justify-between gap-2 border-t pt-2">
            <Button type="button" size="sm" variant="ghost" disabled={!range && !draft?.from} onClick={() => applyRange(undefined)}>清除日期</Button>
            <Button type="button" size="sm" disabled={!draft?.from} onClick={() => {
              if (draft?.from) applyRange({ from: draft.from, to: draft.to ?? draft.from });
            }}>应用筛选</Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
