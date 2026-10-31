import {
  CRAWLER_LABELS,
  PROBE_LOCATIONS,
  TIER_CONFIG,
  type CrawlerView,
  type ProbeLocation,
  type ProblemDetail,
  type Tier,
} from '@dxt/shared';
import { describeFailure, formatCause } from './cause';

/** Where the problem was seen: the monitor, its site's tier and the probe timeout for the wording. */
export interface ProblemCauseContext {
  monitorUrl: string;
  /** A key page's cause starts "Home OK · /booking → …" (only the home page can make a site DOWN). */
  isPrimary: boolean;
  tier: Tier;
  timeoutMs: number;
}

/**
 * A PROBLEM's cause line — the ChatAlert board's "PROBLEM cause wording" table: what failed, then
 * where in brackets, e.g. "p50 5.8 s (BKK, SIN, TYO) · over the Tier 2 limit of 5 s for 3 checks in
 * a row", "Home OK · /booking → HTTP 500 (BKK, SIN, TYO)".
 */
export function formatProblemCause(detail: ProblemDetail, ctx: ProblemCauseContext): string {
  const inner = innerCause(detail, ctx);
  return capped(ctx.isPrimary ? inner : `Home OK · ${pathOf(ctx.monitorUrl)} → ${inner}`);
}

/**
 * A key page's PROBLEM in parts, for the replies that name the page (ChatAlert INC-0151, INC-0152):
 * "/booking", "HTTP 404", "/booking → HTTP 404 (BKK, SIN, TYO)". Null for the home page.
 */
export function formatKeyPage(
  detail: ProblemDetail,
  ctx: ProblemCauseContext,
): { path: string; failure: string; cause: string } | null {
  if (ctx.isPrimary) return null;
  const path = pathOf(ctx.monitorUrl);
  return {
    path,
    failure: capped(innerSummary(detail, ctx)),
    cause: capped(`${path} → ${innerCause(detail, ctx)}`),
  };
}

/** What `monitor_status.cause` holds: a long keyword list or path is cut, never refused. */
export const MAX_CAUSE_LENGTH = 500;
const capped = (text: string) =>
  text.length <= MAX_CAUSE_LENGTH ? text : `${text.slice(0, MAX_CAUSE_LENGTH - 1)}…`;

/**
 * The short form for the Chat text line, after "PROBLEM · <site> (Tier n) · " — "slow, p50 5.8 s",
 * "blocked by bot protection, not verified", "key page /booking, HTTP 500".
 */
export function formatProblemSummary(detail: ProblemDetail, ctx: ProblemCauseContext): string {
  const short = innerSummary(detail, ctx);
  return capped(ctx.isPrimary ? short : `key page ${pathOf(ctx.monitorUrl)}, ${short}`);
}

function innerCause(d: ProblemDetail, ctx: ProblemCauseContext): string {
  const path = pathOf(ctx.monitorUrl);
  switch (d.kind) {
    case 'slow': {
      const tierLimit = TIER_CONFIG[ctx.tier].slowThresholdMs;
      const limit = d.thresholdMs === tierLimit ? `the Tier ${ctx.tier} limit` : 'its limit';
      return `p50 ${seconds(d.p50Ms)} (${where(d.locations)}) · over ${limit} of ${seconds(d.thresholdMs)} for 3 checks in a row`;
    }
    case 'keyword': {
      // A crawler view names itself instead of the locations (D-041): "(as Googlebot)".
      const seen = d.view ? CRAWLER_LABELS[d.view] : where(d.locations);
      return [
        d.missing.length ? `Missing ${quoted(d.missing)} on ${path} (${seen})` : null,
        d.forbidden.length ? `Found ${quoted(d.forbidden)} on ${path} (${seen})` : null,
      ]
        .filter(Boolean)
        .join(' · ');
    }
    case 'redirect':
      return `${path} → ${plain(d.host)} · not in this site’s allowlist${viewed(d.view)}`;
    case 'regional': {
      const failure = lowerFirst(describeFailure({ location: d.location, ...d.failure }, ctx.timeoutMs));
      return `${d.location} failing ${d.minutes} min (${failure}) · ${where(d.okLocations)} OK`;
    }
    case 'status':
      return `HTTP ${d.statusCode} (${where(d.locations)})`;
    case 'hard_fail':
      return formatCause(d.failing, ctx.timeoutMs);
    case 'tls_chain':
      return `TLS chain misconfigured (${where(d.locations)}) · most browsers open it, apps and API clients fail`;
    case 'browser':
      return `Browser: page didn’t load${d.detail ? ` (${d.detail})` : ''}`;
    case 'blocked':
      return `${d.statusCode ? `HTTP ${d.statusCode} bot challenge` : 'Bot challenge'} (${where(d.locations)}) · ${
        d.reason === 'browser_blocked'
          ? 'blocked in the browser too'
          : d.reason === 'control_failed'
            ? 'BKK network check failed, not verified'
            : 'browser verifier unavailable'
      }`;
    case 'content_change':
      return `${d.path} · ${pageChange(d)}`;
    case 'intermittent':
      return `Timing out on and off (${where(d.locations)}) · ${d.blips} times in ${d.windowMin} min`;
  }
}

function innerSummary(d: ProblemDetail, ctx: ProblemCauseContext): string {
  switch (d.kind) {
    case 'slow':
      return `slow, p50 ${seconds(d.p50Ms)}`;
    case 'keyword':
      return d.missing.length
        ? `${quoted(d.missing)} missing${viewed(d.view)}`
        : `${quoted(d.forbidden)} found on the page${viewed(d.view)}`;
    case 'redirect':
      return `redirects to ${plain(d.host)}${viewed(d.view)}`;
    case 'regional':
      return `${d.location} failing ${d.minutes} min`;
    case 'status':
      return `HTTP ${d.statusCode}`;
    case 'hard_fail': {
      const codes = [...new Set(d.failing.map((f) => describeFailure(f, ctx.timeoutMs)))];
      return codes.join(', ');
    }
    case 'tls_chain':
      return 'TLS chain misconfigured';
    case 'browser':
      return 'page didn’t load in the browser';
    case 'blocked':
      if (d.reason === 'browser_blocked') return 'blocked by bot protection, in the browser too';
      if (d.reason === 'control_failed')
        return 'blocked by bot protection, not verified (BKK network check failed)';
      return 'blocked by bot protection, not verified';
    case 'content_change':
      return pageChangeSummary(d);
    case 'intermittent':
      return 'timing out on and off';
  }
}

/** "/booking" for a key page, "/" for a home page. */
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || '/';
  } catch {
    return url;
  }
}

/** Text from outside (a redirect host) can't open a Chat mention or link: `<…|…>` is stripped. */
const plain = (text: string) => text.replace(/[<>|]/g, '');

/** " (as Googlebot)" / " (from Google search)" for what only a crawler view saw; else nothing. */
const viewed = (view: CrawlerView | undefined) => (view ? ` (${CRAWLER_LABELS[view]})` : '');

/** Locations in BKK / SIN / TYO order. */
function where(locations: readonly ProbeLocation[]): string {
  return PROBE_LOCATIONS.filter((l) => locations.includes(l)).join(', ');
}

/** 5800 → "5.8 s", 5000 → "5 s". */
function seconds(ms: number): string {
  return `${Number((ms / 1000).toFixed(1))} s`;
}

/** “Book a session”, “Welcome” — page text never carries markup into a card. */
function quoted(texts: readonly string[]): string {
  return texts.map((t) => `“${t.replace(/[<>]/g, '')}”`).join(', ');
}

/** "Timeout > 30 s" reads "timeout > 30 s" inside the brackets; "HTTP 500", "DNS error" stay. */
function lowerFirst(text: string): string {
  return /^(HTTP|DNS|TLS)\b/.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1);
}
type PageChange = Extract<ProblemDetail, { kind: 'content_change' }>;

/** How a Page change names a text field: "title" as spec §26.9, the others as the card's rows. */
const PAGE_FIELD_WORDS: Record<string, string> = {
  title: 'title',
  description: 'meta description',
  robots: 'robots',
  canonical: 'canonical URL',
  h1: 'main heading',
};

/** The changes that alert: each text field, the new script domains, the new link domains. */
function alertingChanges(d: PageChange): string[] {
  return [
    ...d.changes.filter((c) => c.field in PAGE_FIELD_WORDS).map((c) => PAGE_FIELD_WORDS[c.field]!),
    ...(d.newScriptDomains.length ? ['script domains'] : []),
    ...(d.newLinkDomains.length ? ['link domains'] : []),
  ];
}

const scriptDomains = (d: PageChange) =>
  `new script domain ${plain(d.newScriptDomains[0]!)}${
    d.newScriptDomains.length > 1 ? ` (+${d.newScriptDomains.length - 1} more)` : ''
  }`;

/**
 * The Chat text line (spec §26.3's words): one change → "title changed", "new script domain X";
 * several → "3 changes · new script domain X".
 */
function pageChangeSummary(d: PageChange): string {
  const changes = alertingChanges(d);
  if (changes.length > 1)
    return `${changes.length} changes${d.newScriptDomains.length ? ` · ${scriptDomains(d)}` : ''}`;
  if (d.newScriptDomains.length) return scriptDomains(d);
  return d.newLinkDomains.length ? 'new link domains' : `${changes[0] ?? 'page'} changed`;
}

/**
 * Spec §26.9: `new script domain evil-cdn.example`, else the first changed text field
 * `title “Bangkok Airways – Taiwan” → “… | สล็อตออนไลน์”` (a shared start reads "…"), else the new
 * link domains.
 */
function pageChange(d: PageChange): string {
  if (d.newScriptDomains.length) return scriptDomains(d);
  const text = d.changes.find((c) => c.field in PAGE_FIELD_WORDS);
  if (text) {
    const was = text.was ?? '';
    const now = text.now ?? '';
    // A shared start reads "…" only at a word break: "Shop" → "Shopping" stays whole.
    const rest = now.slice(was.length);
    const shown = was && now.startsWith(was) && /^[\s\p{P}]/u.test(rest) ? `…${rest}` : now;
    return `${PAGE_FIELD_WORDS[text.field]} ${was ? quoted([was]) : '(none)'} → ${shown ? quoted([shown]) : '(none)'}`;
  }
  const links = d.newLinkDomains;
  return `new link domain${links.length === 1 ? '' : 's'} ${links.map(plain).join(', ')}`;
}
