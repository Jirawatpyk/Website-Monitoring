// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * D-079 (engine review H1): a query that loads incident events for drops must read every type
 * `episodesOf` uses. A hand-written list that names `recovered` and `relapsed` side by side drifts
 * (seven of them missed `monitoring_stopped`), so code uses `DROP_EVENT_TYPES` from `@dxt/engine`.
 */
const SRC = join(__dirname, '..', '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('drop event lists (D-079)', () => {
  it('no source file spells the drop events out by hand', () => {
    // Recent events' own word list (acks, steps…) — it words events, it never builds drops.
    const words = join(SRC, 'features', 'overview', 'model.ts');
    const offenders = files(SRC)
      .filter((f) => f !== words)
      .filter((f) =>
        /\[\s*'detected',[^\]]*'recovered'[^\]]*\]|\[\s*'detected',[^\]]*'relapsed'[^\]]*'escalated_to_down'[^\]]*\]/.test(
          readFileSync(f, 'utf8'),
        ),
      );
    expect(offenders).toEqual([]);
  });
});
