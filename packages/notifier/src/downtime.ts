import { clockMinutes, formatDay, formatDuration, formatTime, isSameBangkokDay } from '@dxt/shared';

/**
 * How long a site was down, for RECOVERED and ACKNOWLEDGED messages (spec §6: from the first failed
 * check). Whole clock minutes, so the number matches the range shown (19:37–19:42 = 5 min), and at
 * least "1 min" — a confirmed DOWN always lasted some time, and "0 min" reads as no outage.
 * Past midnight in Bangkok the range names both days.
 */
export function downtime(startedAt: Date, endedAt: Date): { duration: string; range: string } {
  const duration = formatDuration(clockMinutes(startedAt, endedAt));
  const at = (d: Date) =>
    isSameBangkokDay(startedAt, endedAt)
      ? formatTime(d)
      : `${formatDay(d, { weekday: true })} ${formatTime(d)}`;
  return { duration, range: `${at(startedAt)}–${at(endedAt)}` };
}
