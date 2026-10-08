// @vitest-environment node
import { existsSync, readdirSync } from 'node:fs';
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
});
