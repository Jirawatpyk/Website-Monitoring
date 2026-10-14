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
      // `@bar` is the phone top bar's slot (D-045), not a page: its data pages carry their own loading bar.
      .filter((e) => e.isDirectory() && !e.name.startsWith('@'))
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

  // A page without its own `@bar` page keeps the previous page's top bar after a client-side navigation
  // (parallel routes keep an unmatched slot), and a catch-all slot turns unknown addresses into pages (D-045).
  it('every signed-in page has a phone top bar in the @bar slot, and the slot has no catch-all', () => {
    const BAR = join(APP, '@bar');
    const missing = pageDirs(APP)
      .map((dir) => relative(APP, dir))
      .filter((rel) => !existsSync(join(BAR, rel, 'page.tsx')))
      .map((rel) => rel.replaceAll('\\', '/') || '(app) root');
    expect(missing).toEqual([]);
    const catchAll = readdirSync(BAR, { recursive: true }).filter((p) => String(p).includes('[...'));
    expect(catchAll).toEqual([]);
  });

  // Tailwind reads `_` inside an arbitrary variant as a space, so `[&_.aura-page-header__title]` compiles to
  // `.aura-page-header title` and matches nothing; a unit test that only checked the class string passed
  // (D-045 build, retro 14 Oct). Name AURA's `__` classes in globals.css instead.
  it('no Tailwind arbitrary variant names a class with "__"', () => {
    const SRC = join(__dirname, '..');
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
      );
    const bad = files(SRC).filter(
      (f) => !f.endsWith('loading-coverage.test.ts') && /\[&[^\]\s'"`]*__/.test(readFileSync(f, 'utf8')),
    );
    expect(bad.map((f) => relative(SRC, f).replaceAll('\\', '/'))).toEqual([]);
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
