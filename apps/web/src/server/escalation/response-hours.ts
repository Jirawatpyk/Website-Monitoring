import 'server-only';
import type { DbClient } from '@dxt/db';
import { timeToMinutes, type ResponseHours } from '@dxt/shared';

/** Holidays this far back are enough for any open incident's clock. */
const HOLIDAYS_BACK_DAYS = 60;

/**
 * Response hours for Tier 2–3 (organisation_settings) and the company holidays near `now` (D-034):
 * read once per engine run and per notifier batch. Fails loudly — a ladder without its hours would
 * page at night.
 */
export async function loadResponseHours(db: DbClient, now: Date): Promise<ResponseHours> {
  const from = new Date(now.getTime() - HOLIDAYS_BACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const [settings, holidays] = await Promise.all([
    db.from('organisation_settings').select('response_start, response_end, response_days').single(),
    db.from('company_holidays').select('day').gte('day', from),
  ]);
  if (settings.error) throw new Error(`organisation_settings: ${settings.error.message}`);
  if (holidays.error) throw new Error(`company_holidays: ${holidays.error.message}`);
  return {
    startMin: timeToMinutes(settings.data.response_start),
    endMin: timeToMinutes(settings.data.response_end),
    days: settings.data.response_days,
    holidays: new Set(holidays.data.map((h) => h.day)),
  };
}
