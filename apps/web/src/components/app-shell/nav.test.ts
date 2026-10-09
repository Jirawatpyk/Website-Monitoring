import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { activeNavId, NAV_SECTIONS } from './nav';

const appDir = path.resolve(import.meta.dirname, '../../app');

/** A nav href is served by a page in the (app) route group. */
function hasPage(href: string): boolean {
  const route = href === '/' ? '' : href;
  return existsSync(path.join(appDir, '(app)', route, 'page.tsx'));
}

describe('NAV_SECTIONS', () => {
  const items = NAV_SECTIONS.flatMap((section) => section.items);

  it('links only to pages that exist — no dead controls (spec §14.16)', () => {
    const missing = items.filter((item) => item.href && !hasPage(item.href)).map((item) => item.href);
    expect(missing).toEqual([]);
  });

  it('has no empty section and no duplicate ids', () => {
    expect(NAV_SECTIONS.every((section) => section.items.length > 0)).toBe(true);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });
});

describe('activeNavId', () => {
  it.each([
    ['/', 'overview'],
    ['/login', null],
    ['/incidents/x', 'incidents'], // live since S07
    ['/overview-x', null],
  ])('%s → %s', (pathname, expected) => {
    expect(activeNavId(pathname)).toBe(expected);
  });
});
