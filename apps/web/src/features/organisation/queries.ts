import 'server-only';
import { formatResponseHours, timeToMinutes, type Tier } from '@dxt/shared';
import type { ServerClient } from '@/lib/supabase/server';
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
}

const hhmm = (t: string) => {
  const m = timeToMinutes(t);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** The Organisation page for an Admin (RLS as the user: staff read; the storage RPC is Admin-only). */
export async function loadOrganisation(db: ServerClient): Promise<OrganisationData> {
  const [settings, sites, clients, storage] = await Promise.all([
    db.from('organisation_settings').select('response_start, response_end, response_days').single(),
    db.from('sites').select('name, tier, client_id').eq('is_active', true).order('name'),
    db
      .from('clients')
      .select('id, name, is_internal, language, am:profiles!clients_am_user_id_fkey(display_name)')
      .order('name'),
    db.rpc('organisation_storage'),
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
  };
}
