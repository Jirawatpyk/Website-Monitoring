// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(p);
    return e.name.endsWith('.tsx') && !e.name.includes('.test.') ? [p] : [];
  });
}

/** Buttons that download (a `download` prop, or an href to a .csv / export route) without a plain <a>. */
export function offendersIn(code: string): string[] {
  const out: string[] = [];
  // The opening tag of each Button, up to its first `>` outside {…} (two levels of braces).
  for (const m of code.matchAll(/<Button\b((?:[^>{]|\{(?:[^{}]|\{[^{}]*\})*\})*)>/g)) {
    const attrs = m[1] ?? '';
    const downloads = /\sdownload\b/.test(attrs) || /href=\{?[`'"][^`'"]*(\.csv|\/export)\b/.test(attrs);
    if (downloads && !/linkComponent="a"/.test(attrs))
      out.push(attrs.trim().replace(/\s+/g, ' ').slice(0, 90));
  }
  return out;
}

/**
 * AURA Button renders the app's router Link for an href (providers.tsx), and in production a Link
 * prefetches its href when it shows: a CSV download would run in the background on every page load
 * and filter change (S15 spec-checker H3). A download Button uses a plain <a>.
 */
describe('download links', () => {
  it('catches a download Button on the router Link', () => {
    expect(
      offendersIn('<Button variant="secondary" href={exportHref} download>Export</Button>'),
    ).toHaveLength(1);
    expect(offendersIn('<Button size="sm" href={`/sites/${id}/checks.csv`}>Export</Button>')).toHaveLength(1);
    expect(offendersIn('<Button href={`/sites/${id}/checks.csv`} linkComponent="a">Export</Button>')).toEqual(
      [],
    );
    expect(offendersIn('<Button href="/sites/new">Add site</Button>')).toEqual([]);
  });

  it('every download Button in the app sets linkComponent="a"', () => {
    const found = tsxFiles(SRC).flatMap((file) =>
      offendersIn(readFileSync(file, 'utf8')).map((o) => `${relative(SRC, file)}: ${o}`),
    );
    expect(found).toEqual([]);
  });
});
