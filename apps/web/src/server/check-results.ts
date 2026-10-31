import 'server-only';
import type { Database, DbClient } from '@dxt/db';

type CheckRow = Database['public']['Tables']['check_results']['Insert'];

/**
 * Columns that only add facts to a check (all nullable, added after the table). When a deploy's new
 * code runs before `migrate-production` has added one — Vercel's Deployment Check holds the alias, not
 * the new deployment's crons (8 Oct 2026: SIN / TYO stored nothing for 3 min) — the row is stored
 * without it rather than lost. A new nullable column on `check_results` belongs here — except `confirm`
 * (D-051): a confirm check stored without its flag would count as the round's own check, so it is a
 * core column and the insert fails instead (`check-results.test.ts`).
 */
export const LAG_TOLERANT_COLUMNS = [
  'ttfb_ms',
  'resolved_ip',
  'final_url',
  'keyword_missing',
  'keyword_forbidden',
  'waf',
  'control_ok',
  'akamai_ok',
] as const satisfies readonly (keyof CheckRow)[];

/** The column a "no such column" error names: PostgREST PGRST204 or Postgres 42703. */
export function missingColumn(error: { code?: string; message: string }): string | null {
  if (error.code !== 'PGRST204' && error.code !== '42703') return null;
  return /'([a-z0-9_]+)' column|column "([a-z0-9_]+)"/.exec(error.message)?.slice(1).find(Boolean) ?? null;
}

/**
 * Insert check results; if the database doesn't have one of the fact columns yet, store the rows
 * without it (logged as `schema_lag`) so the probe still records the check and beats.
 */
export async function insertCheckResults(db: DbClient, rows: CheckRow[]): Promise<void> {
  let batch = rows;
  for (let attempt = 0; attempt <= LAG_TOLERANT_COLUMNS.length; attempt += 1) {
    const { error } = await db.from('check_results').insert(batch);
    if (!error) return;
    const column = missingColumn(error);
    if (!column || !(LAG_TOLERANT_COLUMNS as readonly string[]).includes(column)) {
      throw new Error(`check_results: ${error.message}`);
    }
    console.warn(JSON.stringify({ event: 'schema_lag', table: 'check_results', column }));
    batch = batch.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== column)) as CheckRow);
  }
  throw new Error('check_results: too many missing columns');
}
