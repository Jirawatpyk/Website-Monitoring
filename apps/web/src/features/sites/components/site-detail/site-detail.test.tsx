import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SiteDetail } from '../../types';
import { SiteDetailView } from './site-detail';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/sites/s1',
}));

const NOW = '2026-09-25T03:07:00Z'; // Fri 25 Sep 10:07 Bangkok (spec §1)

const detail = (over: Partial<SiteDetail> = {}): SiteDetail => ({
  id: 's1',
  name: 'Bangkok Airways – Taiwan',
  tier: 1,
  live: true,
  status: 'ok',
  statusSince: '2026-09-14T14:18:00Z',
  url: 'https://ba-taiwan.example.test/',
  client: { name: 'Bangkok Airways', internal: false, amName: 'Bua' },
  owner: 'Arm',
  backup: 'Ploy',
  ownerIds: ['arm', 'ploy'],
  slowMs: 3000,
  hosting: 'Example hosting',
  credentialRef: 'Team vault › BA',
  mutedUntil: null,
  openIncident: null,
  stats: { uptime: 0.9997, p50: 398, p95: 740, incidents: 2, caption: '1 DOWN 11 min · 1 PROBLEM 6 min' },
  chart: { BKK: [], SIN: [], TYO: [] },
  chartFrom: Date.parse(NOW) - 30 * 86_400_000,
  chartTo: Date.parse(NOW),
  round: [
    {
      location: 'BKK',
      glyph: 'pass',
      outcome: 'pass',
      statusCode: 200,
      responseMs: 212,
      checkedAt: '2026-09-25T03:07:10Z',
    },
    {
      location: 'SIN',
      glyph: 'blocked',
      outcome: 'blocked',
      statusCode: 403,
      responseMs: 90,
      checkedAt: '2026-09-25T03:07:04Z',
    },
  ],
  monitors: [
    {
      id: 'm1',
      isPrimary: true,
      target: '/',
      assertions: 'Status 2xx–3xx · timeout 30 s',
      status: 'ok',
      cause: null,
      lastMs: 412,
    },
  ],
  history: [
    {
      id: 'i131',
      number: 131,
      startedAt: '2026-09-14T14:12:00Z',
      minutes: 6,
      open: false,
      cause: null,
      trigger: 'regional',
      severity: 'problem',
      state: 'resolved',
      level: 0,
    },
    {
      id: 'i118',
      number: 118,
      startedAt: '2026-09-01T20:40:00Z',
      minutes: 11,
      open: false,
      cause: null,
      trigger: 'hard_fail',
      severity: 'down',
      state: 'closed',
      level: 0,
    },
  ],
  historyMttr: 11,
  historyCount: 2,
  rangeIncidents: [],
  log: [],
  checksToday: 1830,
  ...over,
});

describe('SiteDetailView (SiteDetail / MSite boards)', () => {
  it('shows status, since, the stats and the latest round in words', () => {
    render(<SiteDetailView detail={detail()} range="30d" role="admin" meId="tao" nowIso={NOW} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Bangkok Airways – Taiwan' })).toBeInTheDocument();
    expect(screen.getByText('OK since Mon 14 Sep 21:18 · 10 d 12 h')).toBeInTheDocument();
    expect(screen.getAllByText('99.97%').length).toBeGreaterThan(0);
    expect(screen.getByText('1 DOWN 11 min · 1 PROBLEM 6 min')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'SIN: Blocked by bot protection' })).toBeInTheDocument();
    expect(screen.getByText('1/2 pass')).toBeInTheDocument();
  });

  it('Mute and maintenance are disabled with the reason until S09 (no dead controls, §14.16)', () => {
    render(<SiteDetailView detail={detail()} range="30d" role="admin" meId="tao" nowIso={NOW} />);
    const mute = screen.getByRole('button', { name: 'Mute' });
    expect(mute).toBeDisabled();
    expect(mute).toHaveAccessibleDescription('Mute and maintenance come with maintenance windows.');
  });

  it("Mute shows for an Admin and the site's owner or backup, not for a Viewer or another Responder", () => {
    const { unmount } = render(
      <SiteDetailView detail={detail()} range="30d" role="responder" meId="ploy" nowIso={NOW} />,
    );
    expect(screen.getByRole('button', { name: 'Mute' })).toBeDisabled();
    unmount();
    const r2 = render(
      <SiteDetailView detail={detail()} range="30d" role="responder" meId="nok" nowIso={NOW} />,
    );
    expect(screen.queryByRole('button', { name: 'Mute' })).not.toBeInTheDocument();
    r2.unmount();
    render(<SiteDetailView detail={detail()} range="30d" role="viewer" meId="mint" nowIso={NOW} />);
    expect(screen.queryByRole('button', { name: 'Mute' })).not.toBeInTheDocument();
    expect(screen.queryByText('Mute and maintenance come with maintenance windows.')).not.toBeInTheDocument();
  });

  it('a TLS chain check is a warning in the check log, not a fail (D-029); counts read with separators', () => {
    render(
      <SiteDetailView
        detail={detail({
          log: [
            {
              id: 'c1',
              checkedAt: '2026-09-25T03:07:00Z',
              location: 'SIN',
              outcome: 'fail',
              statusCode: null,
              responseMs: 120,
              ttfbMs: null,
              error: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
            },
            {
              id: 'c2',
              checkedAt: '2026-09-25T03:07:01Z',
              location: 'TYO',
              outcome: 'fail',
              statusCode: 503,
              responseMs: 900,
              ttfbMs: null,
              error: null,
            },
          ],
        })}
        range="24h"
        role="admin"
        meId="tao"
        nowIso={NOW}
      />,
    );
    expect(screen.getByText('TLS chain')).toBeInTheDocument();
    expect(screen.getByText('Fail')).toBeInTheDocument();
    expect(screen.getByText('Latest 2 of 1,830 checks today')).toBeInTheDocument();
  });

  it('phones list at most 5 incidents in range, then how many more', () => {
    const inc = (n: number) => ({ ...detail().history[0]!, id: `i${n}`, number: n });
    render(
      <SiteDetailView
        detail={detail({ rangeIncidents: [1, 2, 3, 4, 5, 6, 7].map(inc) })}
        range="90d"
        role="admin"
        meId="tao"
        nowIso={NOW}
      />,
    );
    expect(
      screen.getByText('+ 2 more: Regional 14 Sep (6 min), Regional 14 Sep (6 min)'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Was a problem')).toHaveLength(5);
  });

  it('a range with no checks says so instead of an empty chart', () => {
    render(<SiteDetailView detail={detail()} range="7d" role="admin" meId="tao" nowIso={NOW} />);
    expect(screen.getByText('No checks in this range yet.')).toBeInTheDocument();
  });

  it('an Admin edits monitors; others see no Edit', () => {
    const { unmount } = render(
      <SiteDetailView detail={detail()} range="30d" role="admin" meId="tao" nowIso={NOW} />,
    );
    expect(screen.getByRole('link', { name: 'Edit monitors' })).toHaveAttribute('href', '/sites/s1/monitors');
    unmount();
    render(<SiteDetailView detail={detail()} range="30d" role="viewer" meId="mint" nowIso={NOW} />);
    expect(screen.queryByRole('link', { name: 'Edit monitors' })).not.toBeInTheDocument();
  });

  it('history rows link their incident and word the client mapping (§12)', () => {
    render(<SiteDetailView detail={detail()} range="30d" role="admin" meId="tao" nowIso={NOW} />);
    const table = screen.getByRole('table', { name: 'Incident history, last 90 days' });
    expect(within(table).getByRole('link', { name: 'INC-0131' })).toHaveAttribute('href', '/incidents/i131');
    expect(within(table).getByText('Problem · Degraded')).toBeInTheDocument();
    expect(screen.getByText(/2 in 90 days · MTTR 11 min \(DOWN only · median\)/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Export' })).toHaveAttribute('href', '/sites/s1/incidents.csv');
  });

  it('Incident history shows the latest 8 rows, like the Check log beside it; Export has all', () => {
    const h = (n: number) => ({ ...detail().history[0]!, id: `i${n}`, number: n });
    const many = Array.from({ length: 22 }, (_, i) => h(i + 1));
    render(
      <SiteDetailView
        detail={detail({ history: many, historyCount: 22 })}
        range="90d"
        role="admin"
        meId="tao"
        nowIso={NOW}
      />,
    );
    const table = screen.getByRole('table', { name: 'Incident history, last 90 days' });
    expect(within(table).getAllByRole('link')).toHaveLength(8);
    expect(
      screen.getByText(
        /22 in 90 days · MTTR 11 min \(DOWN only · median\) · showing the latest 8, Export has all/,
      ),
    ).toBeInTheDocument();
  });

  it('a draft says it is not monitored; only an Admin can finish setup', () => {
    const { unmount } = render(
      <SiteDetailView
        detail={detail({ live: false, status: null })}
        range="24h"
        role="admin"
        meId="tao"
        nowIso={NOW}
      />,
    );
    expect(screen.getByRole('link', { name: 'Finish setup' })).toHaveAttribute('href', '/sites/s1/edit');
    expect(screen.queryByRole('button', { name: 'Mute' })).not.toBeInTheDocument();
    unmount();
    render(
      <SiteDetailView
        detail={detail({ live: false, status: null })}
        range="24h"
        role="viewer"
        meId="mint"
        nowIso={NOW}
      />,
    );
    expect(screen.getByText('This site is a draft. Only an Admin can finish setup.')).toBeInTheDocument();
  });

  it('a live site before its first round says so', () => {
    render(
      <SiteDetailView
        detail={detail({ status: null, statusSince: null, round: [] })}
        range="24h"
        role="admin"
        meId="tao"
        nowIso={NOW}
      />,
    );
    expect(screen.getByText('No data yet — the first round runs within 1 min')).toBeInTheDocument();
    expect(screen.getByText('No checks in the last 15 minutes.')).toBeInTheDocument();
  });
});
