import { z } from 'zod';
import { BANGKOK_OFFSET_MS, formatMonth } from '@dxt/shared';

/**
 * Report months (S20, D-072): a Bangkok calendar month as `YYYY-MM`. The page shows two — the last
 * complete month (its draft, made on the 1st) and the running one (a live preview).
 */

export const reportMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** The Bangkok month `at` falls in. */
export function monthKeyOf(at: Date): string {
  const d = new Date(at.getTime() + BANGKOK_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The month before `key`. */
export function previousMonth(key: string): string {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** The month after `key`. */
export function nextMonth(key: string): string {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** The two months the page offers: the last complete one first, then the running one. */
export function reportMonths(now: Date): { closed: string; running: string } {
  const running = monthKeyOf(now);
  return { closed: previousMonth(running), running };
}

/** "August 2026"; `short` → "Aug 2026". */
export function monthLabel(key: string, options: { short?: boolean } = {}): string {
  const [y, m] = key.split('-').map(Number) as [number, number];
  // the middle of the month, so no time zone can move it to another one
  const name = formatMonth(new Date(Date.UTC(y, m - 1, 15)));
  return `${options.short ? name.slice(0, 3) : name} ${y}`;
}

/** The month a page request asks for (`?month=`): one of the two offered, else the last complete one. */
export function pickMonth(v: string | string[] | undefined, now: Date): string {
  const s = Array.isArray(v) ? v[0] : v;
  const { closed, running } = reportMonths(now);
  return s === running ? running : closed;
}
