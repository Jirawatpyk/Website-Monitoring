import type { BrowserContext } from '@playwright/test';
import { createServerClient } from '@supabase/ssr';

/**
 * Signed-in e2e flows against the LOCAL Supabase stack only (`pnpm db:start`, seeded by
 * `pnpm db:reset`). Google can't be scripted, so a test user gets a throwaway password through the
 * local admin API and the session cookies are put into the browser — what /auth/callback would set.
 * Enabled with E2E_LOCAL_SUPABASE=1, and only for a local Supabase URL.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
// The Supabase CLI's well-known local demo keys — not secrets, and never sent to a non-local URL.
const PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const SECRET_KEY = process.env.E2E_SUPABASE_SECRET_KEY ?? 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';
const PASSWORD = 'e2e-local-only-Password-1';

export const localSupabaseEnabled =
  process.env.E2E_LOCAL_SUPABASE === '1' && /^http:\/\/(127\.0\.0\.1|localhost):/.test(SUPABASE_URL);

/** Every helper refuses to run unless the target is the local stack — never send these keys elsewhere. */
function assertLocal(): void {
  if (!localSupabaseEnabled)
    throw new Error('local Supabase only: set E2E_LOCAL_SUPABASE=1 and a localhost URL');
}

async function admin(path: string, init: RequestInit = {}): Promise<unknown> {
  assertLocal();
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SECRET_KEY,
      Authorization: `Bearer ${SECRET_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** The auth user for `email` (created without an allowlist row if missing), with the test password. */
export async function ensureUser(email: string): Promise<string> {
  const list = (await admin('/auth/v1/admin/users?per_page=1000')) as {
    users: { id: string; email: string }[];
  };
  const found = list.users.find((u) => u.email === email);
  if (found) {
    await admin(`/auth/v1/admin/users/${found.id}`, {
      method: 'PUT',
      body: JSON.stringify({ password: PASSWORD }),
    });
    return found.id;
  }
  const created = (await admin('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  })) as { id: string };
  return created.id;
}

/** Set a profile's is_active through the local service role. */
export async function setActive(userId: string, isActive: boolean): Promise<void> {
  await admin(`/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ is_active: isActive }),
  });
}

/** Sign `email` in and copy the session cookies into the browser context. */
export async function signIn(context: BrowserContext, baseURL: string, email: string): Promise<void> {
  assertLocal();
  const jar = new Map<string, string>();
  const supabase = createServerClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, url: baseURL })));
}

/**
 * Opens a DOWN incident (Chat + owner email queued, as the engine would) on a new site whose
 * primary owner is `ownerEmail`, so tests never compete for seeded sites. Returns the incident id.
 */
export async function openTestIncident(ownerEmail: string): Promise<string> {
  const [owner] = (await admin(`/rest/v1/profiles?select=id&email=eq.${encodeURIComponent(ownerEmail)}`)) as {
    id: string;
  }[];
  const [client] = (await admin('/rest/v1/clients?select=id&limit=1')) as { id: string }[];
  const [site] = (await admin('/rest/v1/sites?select=id', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      client_id: client!.id,
      name: `E2E ${crypto.randomUUID().slice(0, 8)}`,
      tier: 1,
      primary_owner_id: owner!.id,
    }),
  })) as { id: string }[];
  const now = Date.now();
  return (await admin('/rest/v1/rpc/engine_open_incident', {
    method: 'POST',
    body: JSON.stringify({
      p_site_id: site!.id,
      p_monitor_id: null,
      p_trigger: 'hard_fail',
      p_severity: 'down',
      p_started_at: new Date(now - 120_000).toISOString(),
      p_detected_at: new Date(now - 60_000).toISOString(),
      p_round_at: new Date(now - 120_000).toISOString(),
      p_context: { cause: 'HTTP 500 (SIN, TYO)', confirmingLocations: 2 },
      p_notify: true,
    }),
  })) as string;
}

/** The incident's ACKNOWLEDGED messages: channel and status. */
export async function ackMessages(incidentId: string): Promise<{ channel: string; status: string }[]> {
  return (await admin(
    `/rest/v1/notifications?select=channel,status&incident_id=eq.${incidentId}&template=eq.acknowledged&order=channel`,
  )) as { channel: string; status: string }[];
}

/** The audit rows of a site and its monitors, oldest first: action and actor email (S05 Done-when 3). */
export async function siteAudit(siteId: string): Promise<{ action: string; actor: string | null }[]> {
  const monitors = (await admin(`/rest/v1/monitors?select=id&site_id=eq.${siteId}`)) as { id: string }[];
  const ids = [siteId, ...monitors.map((m) => m.id)].join(',');
  const rows = (await admin(
    `/rest/v1/audit_log?select=action,actor:profiles(email)&entity_id=in.(${ids})&order=at`,
  )) as { action: string; actor: { email: string } | null }[];
  return rows.map((r) => ({ action: r.action, actor: r.actor?.email ?? null }));
}
