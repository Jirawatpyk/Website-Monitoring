import 'server-only';
import { assertPublicTarget, TargetNotAllowedError, type Lookup } from '@dxt/probe';
import { keyPageUrl, type MonitorForm } from '@dxt/shared';
import type { z } from 'zod';
import type { ServerClient } from '@/lib/supabase/server';
import {
  createSiteInputSchema,
  saveMonitorsInputSchema,
  siteIdSchema,
  updateSiteInputSchema,
  type CreateSiteInput,
  type SaveMonitorsInput,
  type UpdateSiteInput,
} from './schemas';
import type { SiteActionResult } from './types';

/**
 * The Sites writes, as the signed-in person (RLS + the SQL rules decide; D-012, D-015, D-025).
 * Every monitor URL passes the SSRF guard before it is saved — the probes check it again on every
 * request and redirect hop. Kept apart from the Server Actions so tests can pass a fake db and DNS.
 */
export interface SitesDeps {
  db: Pick<ServerClient, 'rpc'>;
  /** DNS for the SSRF guard (tests); the system resolver otherwise. */
  lookup?: Lookup;
}

const FAILED = 'Couldn’t save. Check your connection and try again.';
export const DUPLICATE_URL =
  'Already monitored as another site — open that site instead of adding a duplicate.';

interface DbError {
  code?: string;
  message: string;
  hint?: string | null;
  details?: string | null;
}

/** A database refusal in words (the SQL raises carry a hint; `details` names the people). */
export function refusal(error: DbError): Extract<SiteActionResult, { ok: false }> {
  const who = error.details ?? '';
  switch (error.hint) {
    case 'owners_missing_chat_id':
      return {
        ok: false,
        message: `${who} ${who.includes(',') ? 'need' : 'needs'} a Google Chat id before they can own a site — ask an Admin to add it.`,
      };
    case 'owners_not_eligible':
      return { ok: false, message: `${who} can’t own a site — only active Admins and Responders can.` };
    case 'site_not_ready':
      return { ok: false, message: `Not ready to monitor: ${who}.` };
    case 'too_many_key_pages':
      return { ok: false, message: 'At most 3 key pages per site.' };
    case 'primary_not_removable':
      return { ok: false, message: 'The primary monitor can’t be removed.' };
    case 'primary_required':
      return { ok: false, message: 'A site needs its primary monitor.' };
    case 'site_is_live':
      return { ok: false, message: 'Stop monitoring before deleting the site.' };
    case 'monitor_has_open_incident':
      return {
        ok: false,
        message: 'This monitor has an open incident — resolve it before you switch it off or remove it.',
      };
    case 'header_refused':
      return { ok: false, message: 'A custom header can’t set that name or value.' };
    case 'site_has_history':
      return {
        ok: false,
        message: 'This site has monitoring history, so it stays for the record. Stop monitoring instead.',
      };
  }
  switch (error.code) {
    case '23505':
      return error.message.includes('monitors_primary_url_key')
        ? { ok: false, message: DUPLICATE_URL, fieldErrors: { url: DUPLICATE_URL } }
        : {
            ok: false,
            message: 'Another site already has this name.',
            fieldErrors: { name: 'Another site already has this name' },
          };
    case '23503':
      return { ok: false, message: 'The client or a person no longer exists — reload and try again.' };
    case '42501':
      return { ok: false, message: 'Only an Admin can change sites and monitors.' };
    case 'P0002':
      return { ok: false, message: 'This site or monitor doesn’t exist any more.' };
    default:
      return { ok: false, message: FAILED };
  }
}

function invalid(error: z.ZodError): Extract<SiteActionResult, { ok: false }> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.');
    fieldErrors[key] ??= issue.message;
  }
  return { ok: false, message: 'Check the highlighted fields.', fieldErrors };
}

/**
 * The SSRF guard on every URL (Done-when 2): field → reason for each one refused. A host that doesn't
 * resolve right now is not refused — the site may be down at the DNS level, and every probe request
 * checks again before it connects.
 */
export async function refusedTargets(
  urls: { field: string; url: string }[],
  lookup?: Lookup,
): Promise<Record<string, string>> {
  const refused: Record<string, string> = {};
  await Promise.all(
    urls.map(async ({ field, url }) => {
      try {
        await assertPublicTarget(new URL(url), lookup);
      } catch (err) {
        if (!(err instanceof TargetNotAllowedError)) return;
        refused[field] = err.message.endsWith('port')
          ? 'Use the standard port (80 or 443) — probes only check those'
          : 'This address points inside a private network — monitors check public sites only';
      }
    }),
  );
  return refused;
}

/** One monitor as the SQL functions take it. Thresholds keep only what differs from the tier. */
function toRow(m: MonitorForm) {
  return {
    ...(m.id ? { id: m.id } : {}),
    is_primary: m.isPrimary,
    url: m.url,
    method: m.method,
    timeout_ms: m.timeoutSec * 1000,
    must_contain: m.mustContain,
    must_not_contain: m.mustNotContain,
    allowed_redirect_domains: m.allowedRedirectDomains,
    thresholds: m.slowMs ? { slowMs: m.slowMs } : {},
    headers: m.headers,
    enabled: m.enabled,
  };
}

function toSiteRow(s: z.infer<typeof createSiteInputSchema>['site']) {
  return {
    client_id: s.clientId,
    name: s.name,
    tier: s.tier,
    primary_owner_id: s.primaryOwnerId,
    backup_owner_id: s.backupOwnerId,
    hosting: s.hosting,
    credential_ref: s.credentialRef,
    behind_waf: s.behindWaf,
    waf_allowlist_confirmed: s.behindWaf && s.wafAllowlistConfirmed,
  };
}

/** Add site: Save draft (`start: false`) or Start monitoring. */
export async function createSite(
  input: CreateSiteInput,
  { db, lookup }: SitesDeps,
): Promise<SiteActionResult> {
  const parsed = createSiteInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { site, primary, keyPages, start } = parsed.data;

  // Key pages: GET on the primary's origin, its timeout, redirect allowlist and headers.
  const offSite = keyPages.findIndex((path) => {
    try {
      keyPageUrl(primary.url, path);
      return false;
    } catch {
      return true;
    }
  });
  if (offSite >= 0) {
    const message = 'A key page is a path on the site, like /contact';
    return { ok: false, message, fieldErrors: { [`keyPages.${offSite}`]: message } };
  }
  const pages = keyPages.map((path) => ({
    ...primary,
    isPrimary: false,
    url: keyPageUrl(primary.url, path),
    method: 'GET' as const,
    mustContain: [],
    mustNotContain: [],
    slowMs: undefined,
  }));
  const refused = await refusedTargets(
    [
      { field: 'primary.url', url: primary.url },
      ...pages.map((p, i) => ({ field: `keyPages.${i}`, url: p.url })),
    ],
    lookup,
  );
  if (Object.keys(refused).length)
    return { ok: false, message: Object.values(refused)[0]!, fieldErrors: refused };

  const { data, error } = await db.rpc('create_site', {
    p_site: toSiteRow(site),
    p_monitors: [primary, ...pages].map(toRow),
    p_start: start,
  });
  if (error) return withUrlField(refusal(error), 'primary.url');
  return { ok: true, siteId: data };
}

/** Edit site's Save changes. */
export async function updateSite(input: UpdateSiteInput, { db }: SitesDeps): Promise<SiteActionResult> {
  const parsed = updateSiteInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { error } = await db.rpc('update_site', {
    p_site_id: parsed.data.siteId,
    p_site: toSiteRow(parsed.data.site),
  });
  if (error) return refusal(error);
  return { ok: true, siteId: parsed.data.siteId };
}

/** Start monitoring (checked against the checklist in SQL) or Stop monitoring (back to a Draft). */
export async function setMonitoring(
  siteId: string,
  on: boolean,
  { db }: SitesDeps,
): Promise<SiteActionResult> {
  const id = siteIdSchema.safeParse(siteId);
  if (!id.success) return refusal({ code: 'P0002', message: '' });
  const { error } = await db.rpc('set_site_monitoring', { p_site_id: id.data, p_on: on });
  if (error) return refusal(error);
  return { ok: true, siteId: id.data };
}

/** Delete a Draft that has no history. */
export async function deleteSite(siteId: string, { db }: SitesDeps): Promise<SiteActionResult> {
  const id = siteIdSchema.safeParse(siteId);
  if (!id.success) return refusal({ code: 'P0002', message: '' });
  const { error } = await db.rpc('delete_site', { p_site_id: id.data });
  if (error) return refusal(error);
  return { ok: true, siteId: id.data };
}

/** Edit monitors' Save changes: new and edited monitors, and the ones removed. */
export async function saveMonitors(
  input: SaveMonitorsInput,
  { db, lookup }: SitesDeps,
): Promise<SiteActionResult> {
  const parsed = saveMonitorsInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { siteId, upserts, removals } = parsed.data;
  const refused = await refusedTargets(
    upserts.map((m, i) => ({ field: `upserts.${i}.url`, url: m.url })),
    lookup,
  );
  if (Object.keys(refused).length)
    return { ok: false, message: Object.values(refused)[0]!, fieldErrors: refused };

  const { error } = await db.rpc('save_monitors', {
    p_site_id: siteId,
    p_upserts: upserts.map(toRow),
    p_removals: removals,
  });
  if (error) return withUrlField(refusal(error), 'upserts.0.url');
  return { ok: true, siteId };
}

/** A duplicate URL refusal names the URL field it belongs to. */
function withUrlField(result: Extract<SiteActionResult, { ok: false }>, field: string) {
  if (result.fieldErrors?.url) return { ...result, fieldErrors: { [field]: result.fieldErrors.url } };
  return result;
}
