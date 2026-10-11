// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = join(__dirname, '(app)');

function pageDirs(dir: string): string[] {
  const here = existsSync(join(dir, 'page.tsx')) ? [dir] : [];
  return [
    ...here,
    ...readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .flatMap((e) => pageDirs(join(dir, e.name))),
  ];
}

describe('loading skeletons', () => {
  // The shared (app)/loading.tsx is a plain list: a form or editor page that falls back to it jumps
  // from rows to cards when it arrives. Each signed-in page draws its own shape (retro 8 Oct 2026).
  it('every signed-in page has its own loading.tsx (Overview uses the group root)', () => {
    const missing = pageDirs(APP)
      .filter((dir) => !existsSync(join(dir, 'loading.tsx')))
      .map((dir) => relative(APP, dir).replaceAll('\\', '/') || '(app) root');
    expect(missing).toEqual([]);
  });

  // AURA Skeleton without a variant draws a small rounded blob: Site detail's phone buttons and stats
  // came out as pills and circles (S09 /verify). Every one names its shape.
  it('every AURA Skeleton names its variant', () => {
    const SRC = join(__dirname, '..');
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.tsx') ? [join(dir, e.name)] : [],
      );
    const bare = files(SRC).flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(/<Skeleton\b[^>]*>/g)]
        .filter((m) => !m[0].includes('variant='))
        .map(() => relative(SRC, f).replaceAll('\\', '/')),
    );
    expect(bare).toEqual([]);
  });
});
