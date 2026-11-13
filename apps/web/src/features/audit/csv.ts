import { toCsv } from '@/lib/csv';
import type { AuditEntry } from './queries';

/**
 * The Audit log CSV (board AuditLog "Export CSV", plan S15 Done-when 2): the filtered entries only,
 * newest first. Time is Bangkok with its offset; the stored before / after go out as JSON next to
 * the words, so the export keeps everything the log holds. `toCsv` neutralises formula cells —
 * reasons are free text (CSV injection).
 */
const HEADER = [
  'Time (Bangkok)',
  'Actor',
  'Action',
  'What',
  'Entity',
  'Before',
  'After',
  'Before (JSON)',
  'After (JSON)',
] as const;

/** "2026-09-25 10:03:41 +07:00". */
export function bangkokStamp(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 3_600_000);
  return `${d.toISOString().slice(0, 19).replace('T', ' ')} +07:00`;
}

export function auditCsv(entries: readonly AuditEntry[]): string {
  return toCsv(
    HEADER,
    entries.map((e) => [
      bangkokStamp(e.at),
      e.actor,
      e.action,
      e.words,
      e.entity,
      e.before,
      e.after,
      e.beforeJson === null ? '' : JSON.stringify(e.beforeJson),
      e.afterJson === null ? '' : JSON.stringify(e.afterJson),
    ]),
  );
}

/** "audit-log.csv" — the board's file name. */
export const AUDIT_CSV_NAME = 'audit-log.csv';
