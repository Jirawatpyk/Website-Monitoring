// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOARD_WORDS } from './mutations';

const MIGRATIONS = join(__dirname, '../../../../../supabase/migrations');

/** The body of the newest `save_escalation_policies` (later migrations replace earlier ones). */
function latestSaveBody(): string {
  const head = 'create or replace function public.save_escalation_policies';
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  let body = '';
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8');
    const at = sql.lastIndexOf(head);
    if (at >= 0) body = sql.slice(at, sql.indexOf('$$;', at));
  }
  return body;
}

describe('saveEscalation refusals (D-078 spec-check H1)', () => {
  it('every hint the save raises is shown in its own words, never as a network error', () => {
    const hints = [...latestSaveBody().matchAll(/hint\s*=\s*'(\w+)'/g)].map((m) => m[1]!);
    expect(hints.length).toBeGreaterThan(10);
    // Malformed input the page never sends (the zod schema stops it first): no words of their own.
    const internal = new Set(['invalid', 'levels']);
    expect(hints.filter((h) => !BOARD_WORDS.has(h) && !internal.has(h))).toEqual([]);
  });
});
