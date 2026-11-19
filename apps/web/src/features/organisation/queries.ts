import 'server-only';
import { formatResponseHours, minutesToClock, timeToMinutes, type Tier } from '@dxt/shared';
import type { ServerClient } from '@/lib/supabase/server';
import { bangkokToday, type Holiday, type Hours as HolidayHours } from './holidays';
import { daySetOf, TIME_OPTIONS, type Hours, type OrgClient, type OrgSite } from './model';

export interface OrganisationData {
  hours: Hours;
  /**
   * The stored hours in words when they aren't one of the editor's choices (days written by SQL
   * before S17, e.g. "Mon, Wed, Fri 09:00–18:00"); null otherwise. The page says so, and a save replaces them.
   */
  storedOther: string | null;
  /** Live sites (monitoring on): drafts and stopped sites aren't covered by the hours. */
  sites: OrgSite[];
  clients: OrgClient[];
  /** The database size in bytes; null when it couldn't be read (the card says so). */
  storageBytes: number | null;
  /** Company holidays from today (Bangkok) on. */
  holidays: Holiday[];
  /** The stored hours as numbers, for the holiday list's words (a day outside them changes nothing). */
  hoursNow: HolidayHours;
  /** When the page was read (ISO), so "today" is the same on the server and in the browser. */
  now: string;
}

/**
 * The holidays from today on. Until `migrate-production` adds `kind` (the deploy runs first), the read
 * without it still lists them, as public holidays.
 */
async function loadHolidays(db: ServerClient, now: Date): Promise<Holiday[]> {
  const from = bangkokToday(now);
  const full = await db.from('company_holidays').select('id, day, name, kind').gte('day', from).order('day');
  if (!full.error) return full.data.map((h) => ({ ...h, kind: h.kind === 'company' ? 'company' : 'public' }));
  // Only the missing column falls back; any other failure is a real one.
  if (full.error.code !== '42703') throw new Error(`company_holidays: ${full.error.message}`);
  console.error(JSON.stringify({ event: 'company_holidays_kind_missing' }));
  const bare = await db.from('company_holidays').select('id, day, name').gte('day', from).order('day');
  if (bare.error) throw new Error(`company_holidays: ${bare.error.message}`);
  return bare.data.map((h) => ({ ...h, kind: 'public' }));
}

const hhmm = (t: string) => minutesToClock(timeToMinutes(t));

/** The Organisation page for an Admin (RLS as the user: staff read; the storage RPC is Admin-only). */
export async function loadOrganisation(db: ServerClient, now = new Date()): Promise<OrganisationData> {
  const [settings, sites, clients, storage, holidays] = await Promise.all([
    db.from('organisation_settings').select('response_start, response_end, response_days').single(),
    db.from('sites').select('name, tier, client_id').eq('is_active', true).order('name'),
    db
      .from('clients')
      .select('id, name, is_internal, language, am:profiles!clients_am_user_id_fkey(display_name)')
      .order('name'),
    db.rpc('organisation_storage'),
    loadHolidays(db, now),
  ]);
  if (settings.error) throw new Error(`organisation_settings: ${settings.error.message}`);
  if (sites.error) throw new Error(`sites: ${sites.error.message}`);
  if (clients.error) throw new Error(`clients: ${clients.error.message}`);
  if (storage.error) {
    console.error(JSON.stringify({ event: 'organisation_storage_unreadable', error: storage.error.message }));
  }

  const live = sites.data;
  const daySet = daySetOf(settings.data.response_days);
  const from = hhmm(settings.data.response_start);
  const to = hhmm(settings.data.response_end);
  const onGrid = TIME_OPTIONS.includes(from) && TIME_OPTIONS.includes(to);
  return {
    storedOther:
      daySet && onGrid
        ? null
        : formatResponseHours({
            startMin: timeToMinutes(settings.data.response_start),
            endMin: timeToMinutes(settings.data.response_end),
            days: settings.data.response_days,
          }),
    hours: {
      days: daySet ?? 'Mon–Fri',
      from: onGrid ? from : '09:00',
      to: onGrid ? to : '18:00',
    },
    sites: live.map((s) => ({ name: s.name, tier: s.tier as Tier })),
    clients: clients.data.map((c) => ({
      name: c.name,
      internal: c.is_internal,
      amName: c.am?.display_name ?? null,
      language: c.language === 'th' ? 'th' : 'en',
      sites: live.filter((s) => s.client_id === c.id).map((s) => s.name),
    })),
    storageBytes: storage.error ? null : Number(storage.data),
    holidays,
    now: now.toISOString(),
    hoursNow: {
      startMin: timeToMinutes(settings.data.response_start),
      endMin: timeToMinutes(settings.data.response_end),
      days: settings.data.response_days,
    },
  };
}
