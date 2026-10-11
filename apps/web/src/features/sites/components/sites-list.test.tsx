import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SiteListRow } from '../types';
import { SitesList } from './sites-list';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }));

afterEach(() => vi.clearAllMocks());

const NOW = '2026-10-08T03:07:00Z';
const row = (name: string, over: Partial<SiteListRow> = {}): SiteListRow => ({
  id: name.toLowerCase().replace(/\W+/g, '-'),
  name,
  tier: 2,
  live: true,
  client: { id: 'internal', name: 'Internal', internal: true, amName: null },
  owner: { id: 'tao', name: 'Tao' },
  backup: { id: 'nok', name: 'Nok' },
  status: 'ok',
  checkedAt: '2026-10-08T03:06:02Z',
  url: `https://${name.toLowerCase().replace(/\W+/g, '')}.example.com/`,
  mutedUntil: null,
  openIncident: null,
  locations: { BKK: 'pass', SIN: 'pass', TYO: 'chain' },
  p50Ms: null,
  uptime30d: null,
  expiryDays: null,
  ...over,
});

const SITES = [
  row('EQHO Academy', { live: false, status: null, checkedAt: null }),
  row('DxT'),
  row('MuvMi', {
    tier: 1,
    status: 'down',
    client: { id: 'muvmi', name: 'MuvMi', internal: false, amName: 'Bua' },
    owner: { id: 'arm', name: 'Arm' },
    openIncident: {
      id: 'inc-1',
      number: 142,
      state: 'escalated',
      level: 1,
      detectedAt: '2026-10-08T02:49:00Z',
      ackedBy: null,
    },
  }),
  row('DxT Games', { tier: 3, mutedUntil: '2026-10-08T11:00:00Z' }),
  row('Cando Asia', { backup: null, owner: { id: 'nok', name: 'Nok' } }),
];

/** AURA's FilterSelect is a listbox: open it, then choose. */
function pick(name: RegExp, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name }));
  fireEvent.click(screen.getByRole('option', { name: option }));
}

/** The phone list (jsdom renders both trees; CSS picks one). */
function phone() {
  return screen.getByRole('group', { name: 'Filter sites' }).closest<HTMLElement>('.md\\:hidden')!;
}

function table() {
  return screen.getByRole('grid', { name: 'Sites' });
}
function siteNames() {
  // the name column is the second cell of each body row
  return within(table())
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('gridcell')[1]!.textContent ?? '');
}

describe('SitesList (spec §20, Sites board)', () => {
  it('sorts by status by default, drafts last, and words each row', () => {
    render(<SitesList sites={SITES} isAdmin meId="tao" nowIso={NOW} />);
    const names = siteNames();
    expect(names.map((n) => n.split(/Draft|Internal|MuvMi ·/)[0])).toEqual([
      'MuvMi',
      'Cando Asia',
      'DxT',
      'DxT Games',
      'EQHO Academy',
    ]);
    const t = within(table());
    expect(t.getByRole('link', { name: 'INC-0142 · Escalated L1 · 18 min unacked' })).toHaveAttribute(
      'href',
      '/incidents/inc-1',
    );
    expect(t.getByText('MuvMi · AM Bua')).toBeInTheDocument();
    expect(t.getByText('Muted · until 18:00')).toBeInTheDocument();

    expect(t.getAllByRole('img', { name: 'TYO: TLS chain error' }).length).toBeGreaterThan(0);
    expect(t.getByRole('link', { name: 'Finish setup' })).toHaveAttribute('href', '/sites/eqho-academy/edit');
    const visit = t.getByRole('link', { name: 'Visit site: DxT (opens in a new tab)' });
    expect(visit).toHaveAttribute('href', 'https://dxt.example.com/');
    expect(visit).toHaveAttribute('target', '_blank');
  });

  it('status chips filter and count; Muted keeps the real status', () => {
    render(<SitesList sites={SITES} isAdmin meId="tao" nowIso={NOW} />);
    const chips = within(screen.getByRole('group', { name: 'Sites by status' }));
    expect(chips.getByRole('button', { name: /All 5/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chips.getByRole('button', { name: /Muted 1/ }));
    expect(siteNames()).toHaveLength(1);
    expect(siteNames()[0]).toContain('DxT Games');
    expect(within(table()).getByText('OK')).toBeInTheDocument();
    // a second click on the chip clears it
    fireEvent.click(chips.getByRole('button', { name: /Muted 1/ }));
    expect(siteNames()).toHaveLength(5);
  });

  it('"Needs attention" shows open incidents, drafts and sites with no backup', () => {
    render(<SitesList sites={SITES} isAdmin meId="tao" nowIso={NOW} />);
    fireEvent.click(screen.getByRole('switch', { name: /Needs attention \(3\)/ }));
    expect(siteNames().map((n) => n.slice(0, 5))).toEqual(['MuvMi', 'Cando', 'EQHO ']);
  });

  it('Name A–Z keeps drafts last; Clear resets the filters and keeps the sort', () => {
    render(<SitesList sites={SITES} isAdmin meId="tao" nowIso={NOW} />);
    pick(/Sort by/, 'Name A–Z');
    expect(siteNames().map((n) => n.slice(0, 4))).toEqual(['Cand', 'DxTI', 'DxT ', 'MuvM', 'EQHO']);
    pick(/^Tier/, '1');
    expect(siteNames()).toHaveLength(1);
    fireEvent.click(screen.getAllByRole('button', { name: /Clear/ })[0]!);
    expect(siteNames().map((n) => n.slice(0, 4))).toEqual(['Cand', 'DxTI', 'DxT ', 'MuvM', 'EQHO']);
  });

  it('says when nothing matches and offers Clear filters', () => {
    render(<SitesList sites={SITES} isAdmin meId="tao" nowIso={NOW} />);
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Sites by status' })).getByRole('button', {
        name: /^Maintenance 0/,
      }),
    );
    expect(screen.getAllByText('No sites match Status: Maintenance').length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!);
    expect(siteNames()).toHaveLength(5);
  });

  it('every role opens a live row on Site detail (spec §20); only an Admin opens a draft', () => {
    const { unmount } = render(<SitesList sites={SITES} isAdmin meId="tao" nowIso={NOW} />);
    fireEvent.click(within(table()).getAllByRole('row')[3]!);
    expect(push).toHaveBeenCalledWith('/sites/dxt');
    unmount();
    push.mockClear();

    render(<SitesList sites={SITES} isAdmin={false} meId="tao" nowIso={NOW} />);
    expect(within(table()).getByRole('link', { name: 'DxT' })).toHaveAttribute('href', '/sites/dxt');
    fireEvent.click(within(table()).getAllByRole('row')[3]!);
    expect(push).toHaveBeenCalledWith('/sites/dxt');
    expect(within(table()).queryByRole('link', { name: 'Finish setup' })).not.toBeInTheDocument();
    expect(within(table()).getByText('Only an Admin can finish setup')).toBeInTheDocument();
    // the site's owner gets the ⋯ menu for Mute / Schedule maintenance (§11, §20, D-036) — no Edit site
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions for DxT' })[0]!);
    expect(screen.getByRole('menuitem', { name: 'Mute…' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Edit site' })).not.toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    // phone rows open Site detail too (spec §17)
    expect(within(phone()).getAllByRole('link', { name: /MuvMi/ })[0]).toHaveAttribute(
      'href',
      '/sites/muvmi',
    );
  });

  it('one site reads in the singular', () => {
    render(<SitesList sites={[row('VOCA')]} isAdmin meId="tao" nowIso={NOW} />);
    expect(screen.getAllByText('1 site').length).toBeGreaterThan(0);
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Sites by status' })).getByRole('button', { name: /^Down 0/ }),
    );
    expect(
      screen.getAllByText('The site is still there — only this list is filtered.').length,
    ).toBeGreaterThan(0);
  });

  it('a mute that ends on a later day names the day', () => {
    render(
      <SitesList
        sites={[row('VOCA', { mutedUntil: '2026-10-12T02:00:00Z' })]}
        isAdmin
        meId="tao"
        nowIso={NOW}
      />,
    );
    expect(within(table()).getByText('Muted · until Mon 12 Oct 09:00')).toBeInTheDocument();
  });

  it('phones: Clear reaches filters set on a wider screen', () => {
    render(<SitesList sites={SITES} isAdmin meId="tao" nowIso={NOW} />);
    pick(/^Tier/, '1');
    fireEvent.click(within(phone()).getByRole('button', { name: 'Clear' }));
    expect(siteNames()).toHaveLength(5);
  });

  it('phones: All clears every filter but the search, and is off while one is set', () => {
    render(<SitesList sites={SITES} isAdmin meId="tao" nowIso={NOW} />);
    pick(/^Tier/, '1');
    const all = within(phone()).getByRole('button', { name: /^All 5/ });
    expect(all).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(all);
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(siteNames()).toHaveLength(5);
  });

  it('phones: grouped by status, Mine = owner or backup', () => {
    render(<SitesList sites={SITES} isAdmin meId="arm" nowIso={NOW} />);
    const groups = within(phone())
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent);
    expect(groups).toEqual(['DOWN · 1', 'OK · 3', 'DRAFT · 1']);
    const chips = within(screen.getByRole('group', { name: 'Filter sites' }));
    fireEvent.click(chips.getByRole('button', { name: 'Mine 1' }));
    expect(screen.getAllByText('Showing 1 of 5').length).toBeGreaterThan(0);
  });
});
