import { z } from 'zod';

/**
 * S09d (D-041, D-046): the crawler's third fetch of a home page — as the monitor itself (the probe's own
 * User-Agent), whole body, every 30 min — kept as a fingerprint of what a defacer changes. Not one of
 * `CRAWLER_VIEWS`: it runs no keyword or redirect check.
 */
export const FINGERPRINT_VIEW = 'plain' as const;

/** Bounds applied at extraction, so a stored fingerprint stays small (crawler_checks caps it at 32 KB). */
export const FINGERPRINT_LIMITS = { text: 300, domains: 200 } as const;

export const FINGERPRINT_TEXT_FIELDS = ['title', 'description', 'robots', 'canonical', 'h1'] as const;
export const FINGERPRINT_DOMAIN_FIELDS = ['scripts', 'links'] as const;
export type FingerprintTextField = (typeof FINGERPRINT_TEXT_FIELDS)[number];
export type FingerprintDomainField = (typeof FINGERPRINT_DOMAIN_FIELDS)[number];
export type FingerprintField = FingerprintTextField | FingerprintDomainField;

/** The rows in the order the What changed card and the Page fingerprint card list them (spec §26.1). */
export const FINGERPRINT_FIELDS: readonly FingerprintField[] = [
  ...FINGERPRINT_TEXT_FIELDS,
  ...FINGERPRINT_DOMAIN_FIELDS,
];

export const FINGERPRINT_LABELS: Record<FingerprintField, string> = {
  title: 'Page title',
  description: 'Meta description',
  robots: 'Robots',
  canonical: 'Canonical URL',
  h1: 'Main heading (first h1)',
  scripts: 'Script / iframe domains',
  links: 'Link domains',
};

const text = z.string().max(FINGERPRINT_LIMITS.text).nullable().catch(null);
const domains = z.array(z.string().max(253)).max(FINGERPRINT_LIMITS.domains).catch([]);

/** A stored fingerprint (crawler_checks.fingerprint, page_baselines.fingerprint), read defensively. */
export const pageFingerprintSchema = z.object({
  title: text.default(null),
  description: text.default(null),
  robots: text.default(null),
  canonical: text.default(null),
  h1: text.default(null),
  /** Registrable domains of `script[src]` and `iframe[src]`, sorted. */
  scripts: domains.default([]),
  /** Registrable domains of `a[href]`, sorted. */
  links: domains.default([]),
});
export type PageFingerprint = z.infer<typeof pageFingerprintSchema>;

/**
 * Domains a site may add without it meaning defacement (D-046 item 7): analytics, tag managers, ad
 * and pixel tags. Compared as registrable domains, at compare time — editing this list also covers
 * fingerprints already stored. Code only until S17 (like the forbidden list, D-042); never shown.
 */
export const TRACKING_DOMAINS: readonly string[] = [
  'google-analytics.com',
  'googletagmanager.com',
  'googleadservices.com',
  'googlesyndication.com',
  'doubleclick.net',
  'facebook.net',
  'clarity.ms',
  'hotjar.com',
  'tiktok.com',
];

/** Second levels under which a registrable domain has three labels (`example.co.th`). */
const SECOND_LEVELS = new Set([
  'co.th',
  'in.th',
  'go.th',
  'ac.th',
  'or.th',
  'mi.th',
  'net.th',
  'co.uk',
  'org.uk',
  'ac.uk',
  'com.au',
  'net.au',
  'org.au',
  'com.tw',
  'org.tw',
  'co.jp',
  'ne.jp',
  'or.jp',
  'com.sg',
  'com.my',
  'com.hk',
  'co.id',
  'com.vn',
  'com.cn',
  'com.ph',
  'co.kr',
  'co.nz',
]);

/**
 * The registrable domain of a host — the last two labels, or three under a known second level
 * (D-046 item 7). A heuristic, not the Public Suffix List: good enough to keep a CDN's rotating
 * subdomains (`d123.cloudfront.net`) from reading as new domains. An IP literal is kept whole.
 */
export function registrableDomain(host: string): string | null {
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  if (!h || h.length > 253) return null;
  if (/^[\d.]+$/.test(h) || h.includes(':')) return h;
  const labels = h.split('.');
  if (labels.some((l) => !/^[a-z0-9-]{1,63}$/.test(l))) return null;
  if (labels.length <= 2) return h;
  const lastTwo = labels.slice(-2).join('.');
  return SECOND_LEVELS.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}
