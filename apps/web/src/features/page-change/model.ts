import {
  CRAWLER_FRESH_MS,
  FINGERPRINT_DOMAIN_FIELDS,
  FINGERPRINT_FIELDS,
  FINGERPRINT_LABELS,
  isTlsChainError,
  type FingerprintField,
  type PageChangeRow,
  type PageFingerprint,
} from '@dxt/shared';
import { diffFingerprint, isRecording, PAGE_CHANGE_HOLD_FETCHES, PAGE_RECORDING_MS } from '@dxt/engine';

/**
 * S09d (spec §26, D-046): what the Page fingerprint card (Site detail) and the What changed card
 * (Incident) show, built from the monitor's baseline and its newest plain crawler fetches. Pure: the
 * loader reads the rows (RLS as the viewer), this decides the words' inputs.
 */

/** A row of the What changed card: a text field's Was / Now, or a domain set's chips. */
export type ChangeRowView =
  | { field: FingerprintField; label: string; kind: 'text'; was: string | null; now: string | null }
  | {
      field: FingerprintField;
      label: string;
      kind: 'domains';
      added: string[];
      removed: string[];
      unchanged: string[];
    };

/** A row of "Show fingerprint": the value of each field. */
export type FingerprintRowView =
  | { field: FingerprintField; label: string; kind: 'text'; value: string | null }
  | { field: FingerprintField; label: string; kind: 'domains'; domains: string[] };

export type PageChangeStatus =
  /** No baseline yet: the first plain fetch hasn't run. */
  | 'no_fingerprint'
  /** The first 14 days from the first baseline: it records, never alerts. */
  | 'recording'
  | 'matches'
  /** Differs, but hasn't held long enough for a PROBLEM (or no incident is open for it). */
  | 'waiting'
  /** Differs and the site's Page change incident is open. */
  | 'problem'
  /** An Admin accepted a new baseline; the next fetch compares against it. */
  | 'accepted'
  /** The newest plain fetch couldn't read the page (bot protection, a timeout). */
  | 'no_data';

export interface PageChangeView {
  monitorId: string;
  status: PageChangeStatus;
  /** Recording until (ISO): the first baseline + 14 days. */
  recordingUntil: string | null;
  baseline: {
    acceptedAt: string;
    acceptedBy: string | null;
    reason: string | null;
    firstSetAt: string;
  } | null;
  /** The newest usable plain fetch (ISO) and the fetch after it (+30 min). */
  checkedAt: string | null;
  nextFetchAt: string | null;
  /** "Show fingerprint": the current one while recording or with no data, else the baseline. */
  fingerprint: FingerprintRowView[];
  /** The rows that differ from the baseline (empty when it matches). */
  rows: ChangeRowView[];
  /** New script / iframe domains that count (D-046 item 5). */
  newScript: string[];
  /** Usable fetches in a row that differ, and when that run began (ISO). */
  held: number;
  firstSeenAt: string | null;
  /** The plain fetch an accept would make the baseline: the newest usable one. */
  checkId: string | null;
  /** An accept inside its 10 s Undo (spec §26.6). */
  pending: { until: string; byViewer: boolean; reason: string | null } | null;
  /** The site's open Page change incident. */
  incident: { id: string; number: number; since: string } | null;
  /** Why it reads no data: the newest fetch's own failure, or no usable fetch for over an hour. */
  noData: {
    reason: 'blocked' | 'timeout' | 'tls_chain' | 'http' | 'error' | 'stale';
    statusCode: number | null;
  } | null;
}

export interface BaselineRow {
  monitor_id: string;
  fingerprint: PageFingerprint;
  first_set_at: string;
  accepted_at: string;
  accepted_by: string | null;
  reason: string | null;
  undo_before: {
    fingerprint?: PageFingerprint;
    accepted_at?: string;
    accepted_by?: string | null;
    reason?: string | null;
  } | null;
  undo_until: string | null;
  undo_by: string | null;
}

export interface PlainFetch {
  id: string;
  checked_at: string;
  usable: boolean;
  fingerprint: PageFingerprint | null;
  outcome?: string | null;
  status_code?: number | null;
  error?: string | null;
}

export interface PageChangeInput {
  monitorId: string;
  baseline: BaselineRow | null;
  /** Newest first: the newest plain fetches of any kind. */
  fetches: readonly PlainFetch[];
  /** The site's own registrable domains (`ownDomains` from @dxt/engine). */
  own: readonly string[];
  incident: PageChangeView['incident'];
  viewerId: string;
  nameOf: (id: string | null) => string;
  now: Date;
}

const CRAWL_MS = 30 * 60_000;

const label = (f: FingerprintField) => FINGERPRINT_LABELS[f];
const isDomain = (f: FingerprintField) => (FINGERPRINT_DOMAIN_FIELDS as readonly string[]).includes(f);

/** Every field's value, for "Show fingerprint". */
export function fingerprintRows(fp: PageFingerprint): FingerprintRowView[] {
  return FINGERPRINT_FIELDS.map((field) =>
    isDomain(field)
      ? { field, label: label(field), kind: 'domains', domains: fp[field as 'scripts' | 'links'] }
      : {
          field,
          label: label(field),
          kind: 'text',
          value: fp[field as Exclude<FingerprintField, 'scripts' | 'links'>],
        },
  );
}

/**
 * The What changed rows: each differing field, with a domain set's unchanged domains for "and N
 * unchanged" (taken from `baseline`, minus what was removed).
 */
export function changeRows(
  changes: readonly PageChangeRow[],
  baseline: PageFingerprint | null,
): ChangeRowView[] {
  return FINGERPRINT_FIELDS.flatMap((field): ChangeRowView[] => {
    const c = changes.find((x) => x.field === field);
    if (!c) return [];
    if (!isDomain(field))
      return [{ field, label: label(field), kind: 'text', was: c.was ?? null, now: c.now ?? null }];
    const added = c.added ?? [];
    const removed = c.removed ?? [];
    const before = baseline ? baseline[field as 'scripts' | 'links'] : [];
    const unchanged = before.filter((d) => !removed.includes(d) && !added.includes(d));
    return [{ field, label: label(field), kind: 'domains', added, removed, unchanged }];
  });
}

export function buildPageChange(i: PageChangeInput): PageChangeView {
  const b = i.baseline;
  const usable = i.fetches.filter((f) => f.usable && f.fingerprint);
  const newest = usable[0] ?? null;
  const pendingOpen = !!b?.undo_until && Date.parse(b.undo_until) > i.now.getTime();
  // While an accept's Undo is open the page still compares with the previous baseline.
  const compareWith = pendingOpen
    ? (b?.undo_before?.fingerprint ?? b?.fingerprint ?? null)
    : (b?.fingerprint ?? null);
  // …and the header names that baseline, not the accept still in its Undo window (/verify, 15 Oct).
  const shown = pendingOpen && b?.undo_before ? { ...b, ...b.undo_before } : b;
  const base: PageChangeView = {
    monitorId: i.monitorId,
    status: 'no_fingerprint',
    recordingUntil: b ? new Date(Date.parse(b.first_set_at) + PAGE_RECORDING_MS).toISOString() : null,
    baseline: shown
      ? {
          acceptedAt: shown.accepted_at,
          acceptedBy: shown.accepted_by ? i.nameOf(shown.accepted_by) : null,
          reason: shown.reason ?? null,
          firstSetAt: shown.first_set_at,
        }
      : null,
    checkedAt: newest?.checked_at ?? null,
    nextFetchAt: newest ? new Date(Date.parse(newest.checked_at) + CRAWL_MS).toISOString() : null,
    fingerprint: [],
    rows: [],
    newScript: [],
    held: 0,
    firstSeenAt: null,
    checkId: newest?.id ?? null,
    pending: pendingOpen
      ? { until: b!.undo_until!, byViewer: b!.undo_by === i.viewerId, reason: b!.reason }
      : null,
    incident: i.incident,
    noData: null,
  };
  if (!b || !compareWith) {
    // Fetched but never read: say why, not "the first check runs within 30 min" (production, 15 Oct).
    const first = i.fetches[0];
    if (first && !first.usable && !newest) return { ...base, status: 'no_data', noData: failureOf(first) };
    return { ...base, fingerprint: newest?.fingerprint ? fingerprintRows(newest.fingerprint) : [] };
  }

  // The newest read failed, or no usable fetch is fresh: no data (the last fingerprint read is kept).
  const latest = i.fetches[0];
  const stale = !newest || i.now.getTime() - Date.parse(newest.checked_at) > CRAWLER_FRESH_MS;
  if ((latest && !latest.usable) || stale) {
    return {
      ...base,
      status: 'no_data',
      fingerprint: fingerprintRows(newest?.fingerprint ?? b.fingerprint),
      noData: latest && !latest.usable ? failureOf(latest) : { reason: 'stale', statusCode: null },
    };
  }
  if (isRecording({ firstSetAt: new Date(b.first_set_at) }, i.now)) {
    return { ...base, status: 'recording', fingerprint: fingerprintRows(newest!.fingerprint!) };
  }

  const diffOf = (f: PlainFetch) => {
    const d = diffFingerprint(compareWith, f.fingerprint!, i.own);
    return d.alerting ? d : null;
  };
  const diff = diffOf(newest!);
  // An Admin's accept the newest fetch already matches: the next fetch compares against it (§26.8).
  const acceptedSince =
    !!b.accepted_by && !pendingOpen && Date.parse(b.accepted_at) >= Date.parse(newest!.checked_at);
  if (!diff) {
    return {
      ...base,
      status: acceptedSince ? 'accepted' : 'matches',
      fingerprint: fingerprintRows(b.fingerprint),
    };
  }
  let held = 1;
  let firstSeenAt = newest!.checked_at;
  for (const f of usable.slice(1)) {
    if (!diffOf(f)) break;
    held += 1;
    firstSeenAt = f.checked_at;
  }
  return {
    ...base,
    status: i.incident ? 'problem' : 'waiting',
    fingerprint: fingerprintRows(compareWith),
    rows: changeRows(diff.rows, compareWith),
    newScript: diff.newScriptDomains,
    held,
    firstSeenAt,
  };
}

/** How a fetch that couldn't read the page failed. */
function failureOf(f: PlainFetch): NonNullable<PageChangeView['noData']> {
  if (f.outcome === 'blocked') return { reason: 'blocked', statusCode: f.status_code ?? null };
  if (f.error === 'Timeout') return { reason: 'timeout', statusCode: null };
  if (isTlsChainError(f.error)) return { reason: 'tls_chain', statusCode: null };
  if (f.status_code) return { reason: f.status_code >= 400 ? 'http' : 'error', statusCode: f.status_code };
  return { reason: 'error', statusCode: null };
}

/** Fetches still to go before a waiting change becomes a PROBLEM (0 when it would already alert). */
export function fetchesLeft(v: Pick<PageChangeView, 'held' | 'newScript'>): number {
  return v.newScript.length ? 0 : Math.max(0, PAGE_CHANGE_HOLD_FETCHES - v.held);
}
