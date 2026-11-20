import 'server-only';
import { runHttpCheck, type HttpCheckRequest, type HttpCheckResult } from '@dxt/probe';
import { probeRequestHeaders } from '@dxt/shared';
import { getAccess, type Access } from '@/lib/auth/session';
import { serverEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { loadForbiddenList } from '@/server/forbidden-list';
import { testCheckInputSchema } from './schemas';
import type { TestCheckResult } from './types';

/** A response slower than 30 s is a failure (PRD §5), as in the scheduled probes. */
const MAX_TIMEOUT_MS = 30_000;

export interface TestCheckDeps {
  access?: () => Promise<Access>;
  check?: (req: HttpCheckRequest) => Promise<HttpCheckResult>;
  secretHeader?: () => { name: string; value: string } | undefined;
  /** Is this host already a saved monitor's? Only then does the WAF secret header go out. */
  knownHost?: (host: string) => Promise<boolean>;
  /** The shared forbidden list the probes use (D-069); Admins read it under RLS. */
  sharedForbidden?: () => Promise<readonly string[]>;
}

async function forbiddenFromDb(): Promise<readonly string[]> {
  return loadForbiddenList(await createClient());
}

function secretFromEnv() {
  const env = serverEnv();
  return env.PROBE_SECRET_HEADER_VALUE
    ? { name: env.PROBE_SECRET_HEADER_NAME, value: env.PROBE_SECRET_HEADER_VALUE }
    : undefined;
}

/** A saved monitor already points at this host (RLS: staff read monitors). */
async function knownHostFromDb(host: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('monitors').select('url').is('removed_at', null);
  if (error) return false;
  return data.some((m) => {
    try {
      return new URL(m.url).host === host;
    } catch {
      return false;
    }
  });
}

/**
 * Test check (AddSite, EditMonitors; D-025): one check from this function's region with the form's
 * unsaved settings — the same `runHttpCheck` and SSRF guard as the scheduled probe.
 * Admin only (only Admins edit monitors, D-012); nothing is stored or alerted.
 */
export function monitorTestHandler(location: TestCheckResult['location'], deps: TestCheckDeps = {}) {
  const {
    access = getAccess,
    check = runHttpCheck,
    secretHeader = secretFromEnv,
    knownHost = knownHostFromDb,
    sharedForbidden = forbiddenFromDb,
  } = deps;
  return async function POST(request: Request): Promise<Response> {
    const who = await access();
    if (who.status !== 'active') return Response.json({ error: 'Sign in first' }, { status: 401 });
    if (who.profile.role !== 'admin') {
      return Response.json({ error: 'Only an Admin can test monitors' }, { status: 403 });
    }
    const body = testCheckInputSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return Response.json({ error: 'Check the monitor settings' }, { status: 400 });

    const m = body.data;
    // The secret header goes only to a host the team already monitors (security review): a test of a
    // new address can't be used to read the secret off a server someone controls.
    const [known, shared] = await Promise.all([knownHost(new URL(m.url).host), sharedForbidden()]);
    const secret = known ? secretHeader() : undefined;
    const r = await check({
      sharedForbidden: shared,
      url: m.url,
      method: m.method,
      timeoutMs: Math.min(m.timeoutSec * 1000, MAX_TIMEOUT_MS),
      headers: probeRequestHeaders(m.headers, secret),
      mustContain: m.mustContain,
      mustNotContain: m.mustNotContain,
    });
    const refused = r.error?.startsWith('Target not allowed') ?? false;
    const result: TestCheckResult = {
      location,
      outcome: refused ? 'refused' : r.outcome,
      statusCode: r.statusCode,
      responseMs: r.responseMs,
      keywordMissing: r.keywordMissing,
      keywordForbidden: r.keywordForbidden,
      error: r.error,
    };
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  };
}
