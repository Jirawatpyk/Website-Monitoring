import 'server-only';
import { timeToMinutes, type Tier } from '@dxt/shared';
import type { ServerClient } from '@/lib/supabase/server';
import { daySetOf, type Hours, type OrgClient, type OrgSite } from './model';

export interface OrganisationData {
  hours: Hours;
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
    db.from('sites').select('name, tier, is_active, client_id').order('name'),
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

  const live = sites.data.filter((s) => s.is_active);
  return {
    hours: {
      days: daySetOf(settings.data.response_days),
      from: hhmm(settings.data.response_start),
      to: hhmm(settings.data.response_end),
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
