import { PROBE_LOCATIONS, type ProbeLocation, isTlsChainError } from '@dxt/shared';

/** One failed check as the probe recorded it. */
export interface FailedCheck {
  location: ProbeLocation;
  statusCode: number | null;
  /** `runHttpCheck` error: "Timeout" or a Node error code such as ENOTFOUND. */
  error: string | null;
}

/**
 * The cause in words (spec §10): "Timeout > 10 s (SIN, TYO) · HTTP 504 (BKK)" — one part per kind of
 * failure, in the order first seen, each with its locations in BKK / SIN / TYO order. Raw error text
 * never reaches the message; unknown errors read "Connection error".
 */
export function formatCause(checks: readonly FailedCheck[], timeoutMs: number): string {
  const groups = new Map<string, Set<ProbeLocation>>();
  for (const check of checks) {
    const kind = describeFailure(check, timeoutMs);
    const locations = groups.get(kind) ?? new Set<ProbeLocation>();
    locations.add(check.location);
    groups.set(kind, locations);
  }
  return [...groups]
    .map(([kind, locations]) => {
      const ordered = PROBE_LOCATIONS.filter((l) => locations.has(l));
      return `${kind} (${ordered.join(', ')})`;
    })
    .join(' · ');
}

const TLS_ERROR = /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/;

export function describeFailure({ statusCode, error }: FailedCheck, timeoutMs: number): string {
  if (statusCode !== null) return `HTTP ${statusCode}`;
  if (error === 'Timeout') return `Timeout > ${Math.round(timeoutMs / 1000)} s`;
  if (error === 'ENOTFOUND' || error === 'EAI_AGAIN') return 'DNS error';
  if (error === 'ECONNREFUSED') return 'Connection refused';
  if (error === 'ECONNRESET') return 'Connection reset';
  if (isTlsChainError(error)) return 'TLS chain misconfigured';
  if (error && TLS_ERROR.test(error)) return 'TLS error';
  return 'Connection error';
}
