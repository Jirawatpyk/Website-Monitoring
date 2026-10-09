import 'server-only';
import { CLOSED_INCIDENT_STATES_IN, defaultSlowMs, toMonitorHeaders, type SiteStatus } from '@dxt/shared';
import { siteUptimeOver } from '@dxt/engine';
import { createClient } from '@/lib/supabase/server';
import { downEpisodesBySite } from './detail-queries';
import { locationGlyph } from './components/site-list';
import { siteIdSchema } from './schemas';
import type {
  ClientOption,
  ExistingUrl,
  ListLocation,
  MonitorRecord,
  OpenIncident,
  PersonOption,
  RegistrationOptions,
  SiteListRow,
  SiteRecord,
} from './types';

type Client = Awaited<ReturnType<typeof createClient>>;

const THIRTY_DAYS_MIN = 30 * 1440;

/**
 * `/sites` (spec §20): every site with its client · AM, owner · backup, mute, open incident, latest
 * status, each location's latest check of the primary monitor, the 24 h p50 and the 30-day uptime
 * (RLS: staff read all).
 */
export async function listSites(now = new Date()): Promise<SiteListRow[]> {
  const supabase = await createClient();
  const from30d = new Date(now.getTime() - THIRTY_DAYS_MIN * 60_000);
  const [sites, checks, response] = await Promise.all([
    supabase
      .from('sites')
      .select(
        `id, name, tier, is_active, muted_until, monitoring_started_at,
         clients!inner(id, name, is_internal, am:profiles!clients_am_user_id_fkey(display_name)),
         owner:profiles!sites_primary_owner_id_fkey(id, display_name),
         backup:profiles!sites_backup_owner_id_fkey(id, display_name),
         site_status(status, last_round_at),
         monitors(url, is_primary, thresholds),
         incidents(id, number, state, escalation_level, detected_at,
                   acker:profiles!incidents_acked_by_fkey(display_name))`,
      )
      .eq('monitors.is_primary', true)
      .not('incidents.state', 'in', CLOSED_INCIDENT_STATES_IN)
      .order('name'),
    supabase.rpc('site_list_locations'),
    supabase.rpc('site_list_response_24h'),
  ]);
  if (sites.error) throw new Error(`sites: ${sites.error.message}`);
  if (checks.error) throw new Error(`site_list_locations: ${checks.error.message}`);
  if (response.error) throw new Error(`site_list_response_24h: ${response.error.message}`);
  const p50 = new Map(response.data.map((r) => [r.site_id, r.p50_ms]));
  const drops = await downEpisodesBySite(
    supabase,
    sites.data.filter((s) => s.monitoring_started_at).map((s) => s.id),
    from30d,
  );

  const latest = new Map<string, (typeof checks.data)[number]>();
  for (const c of checks.data) latest.set(`${c.site_id}|${c.location}`, c);

  return sites.data.map((s) => {
    const status = Array.isArray(s.site_status) ? s.site_status[0] : s.site_status;
    const tier = s.tier as SiteListRow['tier'];
    const primary = s.monitors.find((m) => m.is_primary);
    const slowMs = slowMsOf(primary?.thresholds) ?? defaultSlowMs(tier);
    const inc = s.incidents[0];
    const glyph = (loc: ListLocation) => {
      if (!s.is_active) return 'none' as const;
      const c = latest.get(`${s.id}|${loc}`);
      return locationGlyph(c && { outcome: c.outcome, error: c.error, responseMs: c.response_ms }, slowMs);
    };
    return {
      id: s.id,
      name: s.name,
      tier,
      live: s.is_active,
      client: {
        id: s.clients.id,
        name: s.clients.name,
        internal: s.clients.is_internal,
        amName: s.clients.am?.display_name ?? null,
      },
      owner: s.owner ? { id: s.owner.id, name: s.owner.display_name } : null,
      backup: s.backup ? { id: s.backup.id, name: s.backup.display_name } : null,
      status: s.is_active ? ((status?.status as SiteStatus | undefined) ?? null) : null,
      checkedAt: s.is_active ? (status?.last_round_at ?? null) : null,
      url: primary?.url ?? null,
      mutedUntil: s.muted_until,
      openIncident: inc
        ? {
            id: inc.id,
            number: inc.number,
            state: inc.state as OpenIncident['state'],
            level: inc.escalation_level,
            detectedAt: inc.detected_at,
            ackedBy: inc.acker?.display_name ?? null,
          }
        : null,
      locations: { BKK: glyph('BKK'), SIN: glyph('SIN'), TYO: glyph('TYO') },
      // "—" while down or in maintenance (spec §20)
      p50Ms:
        s.is_active && status?.status !== 'down' && status?.status !== 'maintenance'
          ? (p50.get(s.id) ?? null)
          : null,
      uptime30d:
        siteUptimeOver(drops.get(s.id) ?? [], {
          now,
          rangeMinutes: THIRTY_DAYS_MIN,
          monitoringStartedAt: s.monitoring_started_at ? new Date(s.monitoring_started_at) : null,
        })?.uptime ?? null,
      expiryDays: null,
    };
  });
}

async function clientOptions(supabase: Client): Promise<ClientOption[]> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, is_internal, am:profiles!clients_am_user_id_fkey(display_name)')
    .order('is_internal', { ascending: false })
    .order('name');
  if (error) throw new Error(`clients: ${error.message}`);
  return data.map((c) => ({
    id: c.id,
    name: c.name,
    internal: c.is_internal,
    amName: c.am?.display_name ?? null,
  }));
}

/** Who can own a site: active Admins and Responders; `linked` = has a Google Chat id (D-015). */
async function peopleOptions(supabase: Client): Promise<PersonOption[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, google_chat_user_id')
    .eq('is_active', true)
    .in('role', ['admin', 'responder'])
    .order('display_name');
  if (error) throw new Error(`profiles: ${error.message}`);
  return data.map((p) => ({ id: p.id, name: p.display_name, linked: !!p.google_chat_user_id?.trim() }));
}

/** Every primary URL and its site, so the form can say "Already monitored as another site". */
async function existingUrls(supabase: Client): Promise<ExistingUrl[]> {
  const { data, error } = await supabase
    .from('monitors')
    .select('url, site_id, sites!inner(name)')
    .eq('is_primary', true);
  if (error) throw new Error(`monitors: ${error.message}`);
  return data.map((m) => ({ url: m.url, siteId: m.site_id, siteName: m.sites.name }));
}

/** What Add site / Edit site choose from. */
export async function getRegistrationOptions(): Promise<RegistrationOptions> {
  const supabase = await createClient();
  const [clients, people, urls] = await Promise.all([
    clientOptions(supabase),
    peopleOptions(supabase),
    existingUrls(supabase),
  ]);
  return { clients, people, existingUrls: urls };
}

/** One site with its monitors (not the removed ones), primary first. Null when unknown. */
export async function getSite(siteId: string): Promise<SiteRecord | null> {
  if (!siteIdSchema.safeParse(siteId).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('sites')
    .select(
      `id, name, tier, client_id, primary_owner_id, backup_owner_id, hosting, credential_ref,
       behind_waf, waf_allowlist_confirmed, is_active, monitoring_started_at,
       owner:profiles!sites_primary_owner_id_fkey(display_name),
       backup:profiles!sites_backup_owner_id_fkey(display_name),
       monitors(id, is_primary, url, method, timeout_ms, must_contain, must_not_contain,
                allowed_redirect_domains, thresholds, headers, enabled, removed_at)`,
    )
    .eq('id', siteId)
    .maybeSingle();
  if (error) throw new Error(`site: ${error.message}`);
  if (!data) return null;
  const monitors: MonitorRecord[] = data.monitors
    .filter((m) => !m.removed_at)
    .map((m) => ({
      id: m.id,
      isPrimary: m.is_primary,
      url: m.url,
      method: m.method === 'HEAD' ? ('HEAD' as const) : ('GET' as const),
      timeoutSec: Math.round(m.timeout_ms / 1000),
      mustContain: m.must_contain,
      mustNotContain: m.must_not_contain,
      allowedRedirectDomains: m.allowed_redirect_domains,
      slowMs: slowMsOf(m.thresholds),
      headers: toMonitorHeaders(m.headers),
      enabled: m.enabled,
    }))
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.url.localeCompare(b.url));
  return {
    id: data.id,
    name: data.name,
    tier: data.tier as SiteRecord['tier'],
    clientId: data.client_id,
    primaryOwnerId: data.primary_owner_id,
    backupOwnerId: data.backup_owner_id,
    ownerName: data.owner?.display_name ?? null,
    backupName: data.backup?.display_name ?? null,
    hosting: data.hosting ?? '',
    credentialRef: data.credential_ref ?? '',
    behindWaf: data.behind_waf,
    wafAllowlistConfirmed: data.waf_allowlist_confirmed,
    live: data.is_active,
    everStarted: !!data.monitoring_started_at,
    monitors,
  };
}

function slowMsOf(thresholds: unknown): number | null {
  const v = (thresholds as { slowMs?: unknown } | null)?.slowMs;
  return typeof v === 'number' && v > 0 ? v : null;
}

/**
 * Whether the alerts Chat Space is set up — the empty Sites list's first setup step. Read on its own,
 * like `probeAllowlistInfo`, so the page doesn't need every server secret.
 */
export function chatConnected(): boolean {
  return !!process.env.GOOGLE_CHAT_ALERTS_WEBHOOK_URL?.trim();
}
