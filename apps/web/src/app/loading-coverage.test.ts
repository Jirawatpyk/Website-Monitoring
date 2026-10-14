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

/** The URL path of a route folder: route groups like `(list)` don't count. */
const routeOf = (rel: string) =>
  rel
    .replaceAll('\\', '/')
    .split('/')
    .filter((p) => p && !/^\(.*\)$/.test(p))
    .join('/');

describe('loading skeletons', () => {
  // The shared (app)/loading.tsx is a plain list: a form or editor page that falls back to it jumps
  // from rows to cards when it arrives. Each signed-in page draws its own shape (retro 8 Oct 2026).
  it('every signed-in page has its own loading.tsx', () => {
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
      .filter((rel) => !existsSync(join(BAR, routeOf(rel), 'page.tsx')))
      .map((rel) => rel.replaceAll('\\', '/') || '(app) root');
    expect(missing).toEqual([]);
    const catchAll = readdirSync(BAR, { recursive: true }).filter((p) => String(p).includes('[...'));
    expect(catchAll).toEqual([]);
    // Without its own loading the slot inherited (app)/loading.tsx: the Overview skeleton filled the top bar
    // (600 px) while a page streamed on staging (/verify, D-045).
    expect(existsSync(join(BAR, 'loading.tsx')), '@bar/loading.tsx').toBe(true);
  });

  // A loading.tsx wraps its folder's layout children and every route below it, and its skeleton streams a 200
  // before a page can call notFound(): /sites/<unknown id> answered 200 (D-045 /verify). Loading files sit in
  // a route group beside their page (`sites/(list)/`), never in a folder that has a dynamic route under it.
  it('no loading.tsx wraps a dynamic route', () => {
    const wrapping = readdirSync(APP, { recursive: true })
      .map((p) => String(p).replaceAll('\\', '/'))
      .filter((p) => p.endsWith('/loading.tsx') || p === 'loading.tsx')
      .map((p) => p.slice(0, -'loading.tsx'.length))
      .filter((dir) => !dir.startsWith('@'))
      .filter((dir) =>
        readdirSync(join(APP, dir || '.'), { withFileTypes: true }).some(
          (e) => e.isDirectory() && e.name.startsWith('['),
        ),
      );
    expect(wrapping).toEqual([]);
  });

  // A static `@bar` page passes its path to phoneBarFor as a literal: it must be its own folder's path,
  // or a copy-paste slip shows another page's title (code review, D-045).
  it("each @bar page's phoneBarFor path is its own route", () => {
    const BAR = join(APP, '@bar');
    const wrong = pageDirs(BAR).flatMap((dir) => {
      const route = `/${relative(BAR, dir).replaceAll('\\', '/')}`.replace(/\/$/, '') || '/';
      const pattern = route.replace(/\[([^\]]+)\]/g, (_m, name: string) => `\${${name}}`);
      const calls = [
        ...readFileSync(join(dir, 'page.tsx'), 'utf8').matchAll(/phoneBarFor\((['`])([^'`]+)\1/g),
      ];
      return calls
        .map((m) => m[2])
        .filter((p) => p !== pattern)
        .map((p) => `${route}: ${p}`);
    });
    expect(wrong).toEqual([]);
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
