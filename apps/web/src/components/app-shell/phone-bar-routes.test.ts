import { describe, expect, it } from 'vitest';
import { phoneBarFor } from './phone-bar-routes';

describe('phoneBarFor (spec §22.1, D-045)', () => {
  it.each([
    ['/', { title: null }],
    ['/incidents', { title: 'Incidents' }],
    ['/sites', { title: 'Sites' }],
    ['/sites/', { title: 'Sites' }],
  ])('a bottom-nav tab %s has no back arrow', (path, expected) => {
    expect(phoneBarFor(path)).toEqual(expected);
  });

  it.each([
    ['/sites/new', 'Add site', '/sites'],
    ['/sites/s1/edit', 'Edit site', '/sites/s1'],
    ['/sites/s1/monitors', 'Edit monitors', '/sites/s1'],
    ['/sites/s1', 'Site', '/sites'],
    ['/incidents/i1', 'Incident', '/incidents'],
    ['/maintenance', 'Maintenance', '/'],
    ['/escalation', 'Escalation', '/'],
  ])('%s reads "%s" with a back arrow to %s', (path, title, back) => {
    const bar = phoneBarFor(path);
    expect(bar.title).toBe(title);
    expect(bar.back?.href).toBe(back);
    expect(bar.back?.label).toMatch(/^Back to /);
  });

  it('an unknown path falls back to the brand', () => {
    expect(phoneBarFor('/nowhere/at/all')).toEqual({ title: null });
  });
});
