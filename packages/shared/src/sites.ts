import { z } from 'zod';
import { TIER_CONFIG, type Tier } from './domain';

// ── Monitor URLs ───────────────────────────────────────────────────────────

/**
 * WHATWG `URL`, present in Node and every browser. Typed locally because this package (and the
 * engine, which compiles it) builds without DOM or Node types.
 */
interface WhatwgUrl {
  href: string;
  protocol: string;
  username: string;
  password: string;
  hash: string;
}
const Url = (globalThis as unknown as { URL: new (input: string, base?: string) => WhatwgUrl }).URL;

/**
 * A monitor URL as stored (S05, D-025): http(s) only, no user:password, no fragment; `URL` already
 * lower-cases the host and gives a bare origin its "/". Throws on anything else. The database keeps
 * one site per primary URL (`monitors_primary_url_key`, case and a trailing slash ignored).
 */
export function normalizeMonitorUrl(raw: string): string {
  const url = new Url(raw.trim());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('http or https only');
  if (url.username || url.password) throw new Error('no credentials in a monitor URL');
  url.hash = '';
  return url.href;
}

/** The key a duplicate primary URL is found by — the same as the database's unique index. */
export function monitorUrlKey(url: string): string {
  return url.toLowerCase().replace(/\/+$/, '');
}

export const monitorUrlSchema = z
  .string()
  .trim()
  .min(1, 'Add the primary URL')
  .max(2048)
  .transform((value, ctx) => {
    try {
      return normalizeMonitorUrl(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Enter a full http:// or https:// address' });
      return z.NEVER;
    }
  });

/** A key page as the AddSite form takes it: a path on the primary URL's host ("/contact"). */
export const keyPagePathSchema = z
  .string()
  .trim()
  .regex(/^\/[^\s#]{0,511}$/, 'Start the path with / (for example /contact)');

/** The key page's full URL on the primary URL's origin. */
export function keyPageUrl(primaryUrl: string, path: string): string {
  return normalizeMonitorUrl(new Url(path, primaryUrl).href);
}

// ── Custom headers ─────────────────────────────────────────────────────────

/** The probe's own secret header (SIN / TYO); its name is configurable, this is the default. */
export const DEFAULT_PROBE_SECRET_HEADER = 'X-DxT-Monitor';

/**
 * Header names a monitor may not set (D-025): the request framing, credentials (anyone with read
 * access sees monitor settings), the probe's fixed User-Agent (WAF allowlists key on it) and the
 * probe's secret header.
 */
export const REFUSED_HEADER_NAMES: readonly string[] = [
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'cookie',
  'authorization',
  'proxy-authorization',
  'user-agent',
  DEFAULT_PROBE_SECRET_HEADER.toLowerCase(),
];

export function isRefusedHeader(name: string, probeSecretHeader = DEFAULT_PROBE_SECRET_HEADER): boolean {
  const n = name.trim().toLowerCase();
  return REFUSED_HEADER_NAMES.includes(n) || n === probeSecretHeader.toLowerCase();
}

export const monitorHeaderSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/, 'Use a header name like Accept-Language')
    .refine((n) => !isRefusedHeader(n), {
      message: 'Set by the monitor itself or a credential — not allowed here',
    }),
  value: z
    .string()
    .max(1024)
    .refine((v) => !/[\r\n]/.test(v), 'One line only'),
});
export type MonitorHeader = z.infer<typeof monitorHeaderSchema>;

/** `monitors.headers` (jsonb) as name / value pairs; anything else in the column is skipped. */
export function toMonitorHeaders(value: unknown): MonitorHeader[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((h: unknown) => {
    const r = h as { name?: unknown; value?: unknown } | null;
    return r && typeof r.name === 'string' && typeof r.value === 'string'
      ? [{ name: r.name, value: r.value }]
      : [];
  });
}

export const monitorHeadersSchema = z
  .array(monitorHeaderSchema)
  .max(10, 'At most 10 headers')
  .refine((hs) => new Set(hs.map((h) => h.name.toLowerCase())).size === hs.length, 'Each header once');

// ── Forms ──────────────────────────────────────────────────────────────────

const phrase = z.string().trim().min(1).max(200);
/** A host name a redirect may end on (EditMonitors "Allowed final hosts"). */
export const hostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)([a-z0-9-]+\.)*[a-z0-9-]+$/, 'Enter a host name like cdn.example.com');
const optionalId = z
  .union([z.uuid(), z.literal(''), z.null()])
  .optional()
  .transform((v) => v || null);

/** The site part of Add site / Edit site. Owners may be empty on a Draft (D-025). */
export const siteFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Add the site name').max(120),
    clientId: z.uuid('Choose the client'),
    tier: z.coerce
      .number()
      .int()
      .min(1)
      .max(3)
      .transform((t) => t as Tier),
    primaryOwnerId: optionalId,
    backupOwnerId: optionalId,
    hosting: z.string().trim().max(200).default(''),
    credentialRef: z.string().trim().max(300).default(''),
    behindWaf: z.boolean().default(false),
    wafAllowlistConfirmed: z.boolean().default(false),
  })
  .refine((s) => !s.primaryOwnerId || s.primaryOwnerId !== s.backupOwnerId, {
    path: ['backupOwnerId'],
    message: 'Same as primary — pick another',
  });
export type SiteForm = z.infer<typeof siteFormSchema>;

/** One HTTP monitor (the primary or a key page) as EditMonitors / Add site send it. */
export const monitorFormSchema = z
  .object({
    id: z.uuid().optional(),
    isPrimary: z.boolean(),
    url: monitorUrlSchema,
    method: z.enum(['GET', 'HEAD']).default('GET'),
    timeoutSec: z.coerce.number().int().min(1, 'At least 1 s').max(60, 'At most 60 s').default(30),
    mustContain: z.array(phrase).max(20).default([]),
    mustNotContain: z.array(phrase).max(20).default([]),
    allowedRedirectDomains: z.array(hostnameSchema).max(20).default([]),
    slowMs: z.coerce.number().int().min(500, 'At least 500 ms').max(60_000, 'At most 60000 ms').optional(),
    headers: monitorHeadersSchema.default([]),
    enabled: z.boolean().default(true),
  })
  // D-022: a HEAD request has no page to read, so it is never keyword-checked.
  .refine((m) => m.method === 'GET' || (m.mustContain.length === 0 && m.mustNotContain.length === 0), {
    path: ['method'],
    message: 'HEAD can’t check the page’s words — use GET, or remove the phrases',
  })
  .refine((m) => !m.isPrimary || m.enabled, {
    path: ['enabled'],
    message: 'The primary monitor is always on',
  });
export type MonitorForm = z.infer<typeof monitorFormSchema>;

/** The slow threshold a monitor starts with: its tier's (PRD §5). */
export function defaultSlowMs(tier: Tier): number {
  return TIER_CONFIG[tier].slowThresholdMs;
}

/** What Must not contain starts with (PRD §5); the shared spam list comes with S17 (D-025). */
export const DEFAULT_MUST_NOT_CONTAIN: readonly string[] = ['Index of /', 'Database error'];

/** Key pages per site (AddSite: "max 3 per site"). */
export const MAX_KEY_PAGES = 3;

// ── Registration checklist (AddSite, PRD §4) ───────────────────────────────

export type ChecklistState = 'done' | 'todo' | 'blocked';

export interface ChecklistItem {
  key: 'url' | 'keyword' | 'tier' | 'primary' | 'backup' | 'client' | 'am' | 'hosting' | 'waf';
  label: string;
  detail: string;
  /** The name in the "N items left: …" line. */
  short: string;
  state: ChecklistState;
  /** Shown and counted, but never blocks Start (WAF status). */
  optional?: boolean;
}

export interface ChecklistPerson {
  id: string;
  name: string;
  /** Has a Google Chat id (D-015). */
  linked: boolean;
}

export interface ChecklistInput {
  url: string;
  /** The primary URL is already another site's (the form looks it up). */
  duplicate: boolean;
  keyPages: readonly string[];
  keyword: string;
  tier: Tier;
  primary: ChecklistPerson | null;
  backup: ChecklistPerson | null;
  client: { name: string; internal: boolean; amName: string | null } | null;
  hosting: string;
  credentialRef: string;
  behindWaf: boolean;
  allowlistConfirmed: boolean;
}

/** The checklist row for each tier (AddSite). */
export const TIER_SUMMARY: Record<Tier, string> = {
  1: 'Tier 1 · every 1 min · 24/7',
  2: 'Tier 2 · every 3 min · Mon–Fri 09:00–18:00',
  3: 'Tier 3 · every 5 min · Mon–Fri 09:00–18:00',
};

const filled = (v: string) => v.trim().length > 0;
const done = { state: 'done' as const };
const todo = { state: 'todo' as const };
const blocked = { state: 'blocked' as const };

function owner(
  person: ChecklistPerson | null,
  linkedDetail: string,
  missing: string,
): Pick<ChecklistItem, 'detail' | 'state'> {
  if (!person) return { detail: missing, ...todo };
  if (!person.linked)
    return { detail: `${person.name} has no Google Chat id — ask an Admin to add it`, ...blocked };
  return { detail: `${person.name} · ${linkedDetail}`, ...done };
}

/**
 * The AddSite registration checklist (PRD §4, D-015, D-025). The database re-checks the required
 * items at Start (`private.site_start_problems`); this is what the form shows while you type.
 */
export function registrationChecklist(input: ChecklistInput): ChecklistItem[] {
  let urlValid = false;
  try {
    normalizeMonitorUrl(input.url);
    urlValid = true;
  } catch {
    urlValid = false;
  }
  const urlOk = urlValid && !input.duplicate;
  const same = !!input.primary && !!input.backup && input.primary.id === input.backup.id;
  const client = input.client;
  const hostOk = filled(input.hosting) && filled(input.credentialRef);

  const items: ChecklistItem[] = [
    {
      key: 'url',
      label: 'URL + key pages',
      short: 'URL',
      ...(urlOk
        ? { detail: ['/', ...input.keyPages].join(' and '), ...done }
        : input.duplicate
          ? { detail: 'This URL is already monitored', ...blocked }
          : { detail: 'Add the primary URL', ...todo }),
    },
    {
      key: 'keyword',
      label: 'Brand keyword set',
      short: 'Brand keyword',
      ...(filled(input.keyword)
        ? { detail: `“${input.keyword.trim()}” must appear on the page`, ...done }
        : { detail: 'Add the brand name the page must contain', ...todo }),
    },
    { key: 'tier', label: 'Tier', short: 'Tier', detail: TIER_SUMMARY[input.tier], ...done },
    {
      key: 'primary',
      label: 'Primary owner',
      short: 'Primary owner',
      ...owner(input.primary, 'Google Chat linked', 'Choose the primary owner'),
    },
    {
      key: 'backup',
      label: 'Backup owner',
      short: 'Backup owner',
      ...(same
        ? { detail: `Same as primary (${input.primary!.name}) — pick someone else`, ...blocked }
        : owner(input.backup, 'linked channel ready', 'Choose the backup owner')),
    },
    {
      key: 'client',
      label: 'Client',
      short: 'Client',
      ...(!client
        ? { detail: 'Choose the client', ...todo }
        : client.internal
          ? { detail: 'Internal site · no client updates', ...done }
          : { detail: `${client.name} · client-update track on`, ...done }),
    },
  ];
  if (client && !client.internal) {
    items.push({
      key: 'am',
      label: 'Account manager',
      short: 'Account manager',
      ...(client.amName
        ? { detail: `${client.amName} gets client-update drafts`, ...done }
        : { detail: 'Required for client sites — ask an Admin to set the AM', ...todo }),
    });
  }
  items.push(
    {
      key: 'hosting',
      label: 'Hosting + credential reference',
      short: 'Credential reference',
      detail: hostOk
        ? 'Hosting and vault location filled in'
        : !filled(input.hosting) && !filled(input.credentialRef)
          ? 'Add hosting provider and credential reference'
          : !filled(input.credentialRef)
            ? 'Add the credential reference'
            : 'Add the hosting provider',
      ...(hostOk ? done : todo),
    },
    {
      key: 'waf',
      label: 'WAF status',
      short: 'WAF',
      optional: true,
      detail: !input.behindWaf
        ? 'Not behind a WAF'
        : input.allowlistConfirmed
          ? 'Allowlist confirmed'
          : 'Allowlist pending — can go live, verifier covers it',
      ...(!input.behindWaf || input.allowlistConfirmed ? done : todo),
    },
  );
  return items;
}

/** The required items still open — Start stays disabled while there is one. */
export function blockingItems(items: readonly ChecklistItem[]): ChecklistItem[] {
  return items.filter((i) => !i.optional && i.state !== 'done');
}

/** "1 item left: Credential reference" / "2 items left: URL, Brand keyword". */
export function itemsLeftText(items: readonly ChecklistItem[]): string {
  const left = blockingItems(items);
  return `${left.length} ${left.length === 1 ? 'item' : 'items'} left: ${left.map((i) => i.short).join(', ')}`;
}

/**
 * The extra request headers a probe sends for a monitor: its custom headers minus any refused name
 * (a row saved before a rule changed, or a renamed secret header), then the probe's secret header,
 * which always wins. Undefined when there are none.
 */
export function probeRequestHeaders(
  custom: readonly { name: string; value: string }[] | undefined,
  secret?: { name: string; value: string },
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const h of custom ?? []) {
    if (!isRefusedHeader(h.name, secret?.name) && !/[\r\n]/.test(h.value)) out[h.name] = h.value;
  }
  if (secret) out[secret.name] = secret.value;
  return Object.keys(out).length ? out : undefined;
}
