import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { activeNavId, bottomNavWithCounts, NAV_SECTIONS } from './nav';

const appDir = path.resolve(import.meta.dirname, '../../app');

/** A folder's page, directly or inside one of its route groups (`sites/(list)/page.tsx`, D-045). */
function pageIn(dir: string): boolean {
  if (existsSync(path.join(dir, 'page.tsx'))) return true;
  if (!existsSync(dir)) return false;
  return readdirSync(dir, { withFileTypes: true }).some(
    (e) => e.isDirectory() && /^\(.*\)$/.test(e.name) && pageIn(path.join(dir, e.name)),
  );
}

/** A nav href is served by a page in the (app) route group. */
function hasPage(href: string): boolean {
  const route = href === '/' ? '' : href;
  return pageIn(path.join(appDir, '(app)', route));
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

describe('bottomNavWithCounts', () => {
  it('puts the open-incident count on Incidents, as the phone boards draw it; 0 shows none', () => {
    expect(bottomNavWithCounts({ incidents: 3 }).find((i) => i.id === 'incidents')).toMatchObject({
      count: 3,
    });
    expect(bottomNavWithCounts({ incidents: 0 }).find((i) => i.id === 'incidents')).not.toHaveProperty(
      'count',
    );
  });
});
