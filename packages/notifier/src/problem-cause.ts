import { PROBE_LOCATIONS, TIER_CONFIG, type ProbeLocation, type ProblemDetail, type Tier } from '@dxt/shared';
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
  return ctx.isPrimary ? inner : `Home OK · ${pathOf(ctx.monitorUrl)} → ${inner}`;
}

/**
 * The short form for the Chat text line, after "PROBLEM · <site> (Tier n) · " — "slow, p50 5.8 s",
 * "blocked by bot protection, not verified", "key page /booking, HTTP 500".
 */
export function formatProblemSummary(detail: ProblemDetail, ctx: ProblemCauseContext): string {
  const short = innerSummary(detail, ctx);
  return ctx.isPrimary ? short : `key page ${pathOf(ctx.monitorUrl)}, ${short}`;
}

function innerCause(d: ProblemDetail, ctx: ProblemCauseContext): string {
  const path = pathOf(ctx.monitorUrl);
  switch (d.kind) {
    case 'slow': {
      const tierLimit = TIER_CONFIG[ctx.tier].slowThresholdMs;
      const limit = d.thresholdMs === tierLimit ? `the Tier ${ctx.tier} limit` : 'its limit';
      return `p50 ${seconds(d.p50Ms)} (${where(d.locations)}) · over ${limit} of ${seconds(d.thresholdMs)} for 3 checks in a row`;
    }
    case 'keyword':
      return [
        d.missing.length ? `Missing ${quoted(d.missing)} on ${path} (${where(d.locations)})` : null,
        d.forbidden.length ? `Found ${quoted(d.forbidden)} on ${path} (${where(d.locations)})` : null,
      ]
        .filter(Boolean)
        .join(' · ');
    case 'redirect':
      return `${path} → ${d.host} · not in this site’s allowlist`;
    case 'regional': {
      const failure = lowerFirst(describeFailure({ location: d.location, ...d.failure }, ctx.timeoutMs));
      return `${d.location} failing ${d.minutes} min (${failure}) · ${where(d.okLocations)} OK`;
    }
    case 'status':
      return `HTTP ${d.statusCode} (${where(d.locations)})`;
    case 'hard_fail':
      return formatCause(d.failing, ctx.timeoutMs);
    case 'browser':
      return `Browser: page didn’t load${d.detail ? ` (${d.detail})` : ''}`;
    case 'blocked':
      return `${d.statusCode ? `HTTP ${d.statusCode} bot challenge` : 'Bot challenge'} (${where(d.locations)}) · ${
        d.reason === 'browser_blocked' ? 'blocked in the browser too' : 'browser verifier unavailable'
      }`;
  }
}

function innerSummary(d: ProblemDetail, ctx: ProblemCauseContext): string {
  switch (d.kind) {
    case 'slow':
      return `slow, p50 ${seconds(d.p50Ms)}`;
    case 'keyword':
      return d.missing.length ? `${quoted(d.missing)} missing` : `${quoted(d.forbidden)} found on the page`;
    case 'redirect':
      return `redirects to ${d.host}`;
    case 'regional':
      return `${d.location} failing ${d.minutes} min`;
    case 'status':
      return `HTTP ${d.statusCode}`;
    case 'hard_fail': {
      const codes = [...new Set(d.failing.map((f) => describeFailure(f, ctx.timeoutMs)))];
      return codes.join(', ');
    }
    case 'browser':
      return 'page didn’t load in the browser';
    case 'blocked':
      return d.reason === 'browser_blocked'
        ? 'blocked by bot protection, in the browser too'
        : 'blocked by bot protection, not verified';
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
