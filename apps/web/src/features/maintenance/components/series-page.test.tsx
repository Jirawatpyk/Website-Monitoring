import { render, screen, waitFor, within } from '@testing-library/react';
import { Toaster } from '@jirawatpyk/aura-react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeriesRow } from '../series-model';
import { MaintenancePageView } from './maintenance-page';

// MaintenancePage STATE › Series / Approve series / Cancel series, spec §32.4–7, 7a: series rows on the
// page, their one action, the dialogs and the 10 s Undo with the series' own words.
const actions = vi.hoisted(() => ({
  decideSeries: vi.fn(async (_: unknown) => ({
    ok: true as const,
    postsAt: new Date(Date.now() + 10_000).toISOString(),
    windows: ['2026-09-28T15:00:00Z', '2026-10-01T15:00:00Z'],
  })),
  cancelSeries: vi.fn(async (_: unknown) => ({
    ok: true as const,
    postsAt: new Date(Date.now() + 10_000).toISOString(),
  })),
  undoSeriesAction: vi.fn(async (_: unknown) => ({ ok: true as const })),
  postSeriesActionNow: vi.fn(async (_: unknown) => ({ ok: true as const })),
  postWindowActionNow: vi.fn(async (_: unknown) => ({ ok: true as const })),
  undoWindowAction: vi.fn(async (_: unknown) => ({ ok: true as const })),
}));
vi.mock('../actions', () => actions);
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/components/use-live-refresh', () => ({ useLiveRefresh: () => true }));

const NOW = '2026-09-25T03:07:00.000Z';
const tubtong: SeriesRow = {
  id: '00000000-0000-4000-8000-0000000000f1',
  siteId: 'site-tub',
  siteName: 'Tubtong',
  tier: 2,
  siteStatus: 'ok',
  rule: { freq: 'weekly', days: [2] },
  startTime: '01:00:00',
  durationMin: 120,
  startsOn: '2026-09-15',
  untilOn: null,
  firstStartsAt: '2026-09-14T18:00:00Z',
  reason: 'WordPress plugin updates',
  createdAt: '2026-09-14T02:10:00Z',
  createdById: 'u-ploy',
  byName: 'Ploy',
  approvedAt: '2026-09-14T04:20:00Z',
  approvedById: 'u-tao',
  approverName: 'Tao',
  declinedAt: null,
  cancelledAt: null,
  outcome: null,
  ownerName: 'Ploy',
  backupName: 'Nok',
  ownerIds: ['u-ploy', 'u-nok'],
  log: [],
  upcoming: ['2026-09-28T18:00:00Z', '2026-10-05T18:00:00Z'],
  cancelledWindows: [],
};
const asked: SeriesRow = {
  ...tubtong,
  id: '00000000-0000-4000-8000-0000000000f2',
  siteId: 'site-ba',
  siteName: 'Bangkok Airways – Taiwan',
  rule: { freq: 'weekly', days: [1, 4] },
  startTime: '22:00:00',
  durationMin: 60,
  startsOn: '2026-09-28',
  firstStartsAt: '2026-09-28T15:00:00Z',
  createdById: 'u-arm',
  byName: 'Arm',
  approvedAt: null,
  approvedById: null,
  approverName: null,
  upcoming: [],
};
const view = (role: 'admin' | 'responder', series = [tubtong, asked]) =>
  render(
    <>
      <MaintenancePageView
        rows={[]}
        series={series}
        sites={[]}
        viewer={{ id: role === 'admin' ? 'u-tao' : 'u-arm', name: role === 'admin' ? 'Tao' : 'Arm', role }}
        viewerEmail="x@example.test"
        nowIso={NOW}
      />
      <Toaster />
    </>,
  );
beforeEach(() => Object.values(actions).forEach((a) => a.mockClear()));
const table = (name: string) => screen.getByRole('region', { name }) as HTMLElement;

describe('series on /maintenance (§32.4)', () => {
  it('a Repeating series section and the waiting one under Waiting for approval', () => {
    view('admin');
    expect(screen.getByRole('heading', { name: /Repeating series/ })).toBeInTheDocument();
    // The When cell breaks only after the arrow (two spans): match the rule's start.
    expect(within(table('Repeating series')).getAllByText(/^Every Tue 01:00/)[0]).toBeInTheDocument();
    expect(
      within(table('Waiting for approval')).getAllByText(/^Every Mon, Thu 22:00/)[0],
    ).toBeInTheDocument();
    expect(screen.getByText(/1 waiting for approval · 1 repeating/)).toBeInTheDocument();
  });

  it('an Admin approves a waiting series: its first windows, then the toast with the count and Undo', async () => {
    const user = userEvent.setup();
    view('admin');
    await user.click(within(table('Waiting for approval')).getAllByRole('button', { name: 'Approve' })[0]!);
    const d = await screen.findByRole('dialog', { name: 'Approve the Bangkok Airways – Taiwan series?' });
    expect(
      within(d).getByText(/The first 4 now: Mon 28 Sep, Thu 1 Oct, Mon 5 Oct, Thu 8 Oct\./),
    ).toBeInTheDocument();
    await user.click(within(d).getByRole('button', { name: 'Approve series' }));
    await waitFor(() =>
      expect(actions.decideSeries).toHaveBeenCalledWith({ seriesId: asked.id, approve: true, reason: '' }),
    );
    expect(
      await screen.findByText('Bangkok Airways – Taiwan series approved · 2 windows scheduled'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Undo/ }));
    await waitFor(() => expect(actions.undoSeriesAction).toHaveBeenCalledWith({ seriesId: asked.id }));
    expect(await screen.findByText('Bangkok Airways – Taiwan series approval undone')).toBeInTheDocument();
  });

  it('the owner cancels a series: the windows not started, a reason, the toast', async () => {
    const user = userEvent.setup();
    render(
      <>
        <MaintenancePageView
          rows={[]}
          series={[tubtong]}
          sites={[]}
          viewer={{ id: 'u-ploy', name: 'Ploy', role: 'responder' }}
          viewerEmail="x@example.test"
          nowIso={NOW}
        />
        <Toaster />
      </>,
    );
    await user.click(
      within(table('Repeating series')).getAllByRole('button', { name: 'Cancel series…' })[0]!,
    );
    const d = await screen.findByRole('dialog', { name: 'Cancel the Tubtong series?' });
    expect(
      within(d).getByText(
        /Cancels the 2 occurrences that haven’t started \(Tue 29 Sep, Tue 6 Oct\)\. Nothing is running now\./,
      ),
    ).toBeInTheDocument();
    expect(
      within(d).getByText('Nok gets an email; the Alerts Space gets one line for the series.'),
    ).toBeInTheDocument();
    const go = within(d).getByRole('button', { name: 'Cancel series' });
    expect(go).toBeDisabled();
    await user.click(within(d).getByRole('textbox', { name: /Reason/ }));
    await user.paste('Plugins now update automatically');
    await user.click(go);
    await waitFor(() =>
      expect(actions.cancelSeries).toHaveBeenCalledWith({
        seriesId: tubtong.id,
        reason: 'Plugins now update automatically',
      }),
    );
    expect(await screen.findByText('Tubtong series cancelled · 2 windows cancelled')).toBeInTheDocument();
  });

  it('the asker withdraws a waiting series; a Decline needs a reason', async () => {
    const user = userEvent.setup();
    view('responder');
    await user.click(within(table('Waiting for approval')).getAllByRole('button', { name: 'Withdraw…' })[0]!);
    const d = await screen.findByRole('dialog', { name: 'Withdraw your series request?' });
    expect(within(d).getByText('Nothing was scheduled, so nothing is cancelled.')).toBeInTheDocument();
  });
});
