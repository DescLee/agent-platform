import type { Automation } from "./api";

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function cronTime(hour: string, minute: string): string | null {
  const h = Number(hour);
  const m = Number(minute);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function automationScheduleLabel(task: Pick<Automation, "schedule" | "schedule_raw">): string {
  const raw = task.schedule_raw;
  if (raw?.kind === "once") return raw.fire_at ? `单次运行：${raw.fire_at}` : "单次运行";

  const parts = (raw?.cron || "").trim().split(/\s+/);
  if (parts.length !== 5) return task.schedule;
  const [minute, hour, dayOfMonth, , dayOfWeek] = parts;
  const time = cronTime(hour, minute);
  if (!time) return task.schedule;
  if (dayOfMonth === "*" && dayOfWeek === "*") return `每天约 ${time}`;
  if (dayOfMonth === "*" && /^\d$/.test(dayOfWeek)) {
    return `每${WEEKDAYS[Number(dayOfWeek) % 7]}约 ${time}`;
  }
  if (/^\d+$/.test(dayOfMonth) && dayOfWeek === "*") return `每月 ${dayOfMonth} 日约 ${time}`;
  return task.schedule;
}

const RUN_STATUS: Record<string, string> = {
  running: "运行中",
  ok: "已完成",
  error: "失败",
  failed: "失败",
};

const RUN_TRIGGER: Record<string, string> = {
  manual: "手动运行",
  scheduled: "定时触发",
  schedule: "定时触发",
  catchup: "补偿运行",
};

export const automationRunStatusLabel = (status: string) => RUN_STATUS[status] || status;
export const automationRunTriggerLabel = (trigger: string) => RUN_TRIGGER[trigger] || trigger;
