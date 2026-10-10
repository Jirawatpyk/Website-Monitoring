import 'server-only';
import type { DbClient } from '@dxt/db';
import { timeToMinutes, type ResponseHours } from '@dxt/shared';

/** Holidays this far back are enough for any open incident's clock. */
const HOLIDAYS_BACK_DAYS = 60;

/** The seeded hours (spec §7: Mon–Fri 09:00–18:00), used when the settings can't be read. */
export const DEFAULT_RESPONSE_HOURS: ResponseHours = {
  startMin: 9 * 60,
  endMin: 18 * 60,
  days: [1, 2, 3, 4, 5],
  holidays: new Set(),
};

/**
 * Response hours for Tier 2–3 (organisation_settings) and the company holidays near `now` (D-034),
 * read once per engine run and per notifier batch. A failed read never stops the engine or the
 * notifier — only the ladder needs it: it logs and falls back to the seeded hours (code review).
 */
export async function loadResponseHours(db: DbClient, now: Date): Promise<ResponseHours> {
  const from = new Date(now.getTime() - HOLIDAYS_BACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const [settings, holidays] = await Promise.all([
    db.from('organisation_settings').select('response_start, response_end, response_days').single(),
    db.from('company_holidays').select('day').gte('day', from),
  ]);
  if (settings.error || !settings.data || holidays.error) {
    console.error(
      JSON.stringify({
        event: 'response_hours_unreadable',
        error: settings.error?.message ?? holidays.error?.message ?? 'no settings row',
      }),
    );
    return DEFAULT_RESPONSE_HOURS;
  }
  return {
    startMin: timeToMinutes(settings.data.response_start),
    endMin: timeToMinutes(settings.data.response_end),
    days: settings.data.response_days,
    holidays: new Set((holidays.data ?? []).map((h) => h.day)),
  };
}
