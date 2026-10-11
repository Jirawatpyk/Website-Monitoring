import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '@jirawatpyk/aura-react';
import type { OverviewData, OverviewSite, OverviewViewer } from '../types';
import { OverviewView } from './overview-view';

const refresh = vi.fn();
const router = { refresh };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/components/use-live-refresh', () => ({ useLiveRefresh: () => true }));

// Fri 25 Sep 2026 10:07:12 (UTC+7) — the boards' "now"; sample names are test fixtures only (§21.11).
const NOW = new Date('2026-09-25T03:07:12Z');
const at = (hhmm: string) => `2026-09-25T${hhmm}:00+07:00`;
const PASS = { BKK: 'pass', SIN: 'pass', TYO: 'pass' } as const;

const site = (name: string, over: Partial<OverviewSite> = {}): OverviewSite => ({
  id: `s-${name}`,
  name,
  tier: 1,
  status: 'ok',
  statusSince: at('06:00'),
  checkedAt: at('10:07'),
  ownerId: 'u-arm',
  ownerName: 'Arm',
  backupId: 'u-ploy',
  amId: 'u-bua',
  mutedUntil: null,
  muteReason: null,
  incident: null,
  locations: PASS,
  chainSince: null,
  p50Ms: 412,
  series: Array.from({ length: 96 }, () => 400),
  failed: Array.from({ length: 96 }, () => false),
  uptime: { uptime: 0.9998, windowMinutes: 43_200, downMinutes: 8, maintenanceMinutes: 0 },
  ...over,
});

const muvmi = site('MuvMi', {
  status: 'down',
  p50Ms: null,
  locations: { BKK: 'fail', SIN: 'fail', TYO: 'fail' },
  incident: {
    id: 'i-142',
    number: 142,
    state: 'unacked',
    severity: 'down',
    dropSeverity: 'down',
    trigger: 'hard_fail',
    level: 0,
    startedAt: at('09:48'),
    detectedAt: at('09:49'),
    recoveredAt: null,
    ackedBy: null,
    cause: 'Timeout ×2 · 504 ×1',
  },
});

const tao: OverviewViewer = { id: 'u-tao', name: 'Tao', kind: 'admin' };

const data = (over: Partial<OverviewData> = {}): OverviewData => ({
  nowIso: NOW.toISOString(),
  viewer: tao,
  sites: [muvmi, site('VOCA', { tier: 2 }), site('ORCA Thailand')],
  drafts: 1,
  events: [
    {
      id: 'e1',
      type: 'detected',
      at: at('09:49'),
      actorName: null,
      payload: { confirmingLocations: 3 },
      incidentNumber: 142,
      severity: 'down',
      trigger: 'hard_fail',
      siteName: 'MuvMi',
      autoResolved: false,
    },
  ],
  kpis: {
    enough: false,
    mttaSeconds: null,
    mttdSeconds: null,
    mttaChange: null,
    mttdChange: null,
    uptime30d: 0.9998,
  },
  probes: { beating: ['BKK', 'SIN', 'TYO'], total: 3, verifier: 'idle' },
  lastRoundAt: at('10:07'),
  ...over,
});

const ackAction = vi.fn();
const undoAction = vi.fn();
const renderView = (d: OverviewData) =>
  render(
    <>
      <OverviewView data={d} ackAction={ackAction} undoAction={undoAction} />
      <Toaster />
    </>,
  );

/** The desktop part (md up); the phone part is in the DOM too, hidden by CSS. */
const desktop = () =>
  screen.getAllByRole('region', { name: 'Unacknowledged DOWN incidents' })[0]!.parentElement!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('OverviewView (Main3 / MOverview4)', () => {
  it('draws the header, banner, KPIs, Live issues, tiles and events from the data', () => {
    renderView(data());
    expect(screen.getByText('Fri 25 Sep 2026 · 10:07:12 (UTC+7) · live')).toBeInTheDocument();
    expect(screen.getAllByText('MuvMi is DOWN — 19 min').length).toBe(2); // desktop + phone
    expect(screen.getByText('18 min unacked')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open INC-0142' })).toHaveAttribute('href', '/incidents/i-142');
    expect(screen.getAllByText('Not enough incidents yet')).toHaveLength(2); // MTTA, MTTD
    expect(screen.getByText('99.98%')).toBeInTheDocument();
    expect(screen.getByText('1 of 3 monitored sites · 1 unacked')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'All monitored sites' })).toBeInTheDocument();
    expect(screen.getByText('3 monitored sites · 1 draft not monitored yet')).toBeInTheDocument();
    expect(screen.getByText('MuvMi DOWN confirmed — 3/3 locations')).toBeInTheDocument();
    // phone: x/y OK, counts, the All sites row
    // one h1 (D-018 page header): "Overview" from md, "2/3 OK" on phones (CSS picks one; jsdom has both)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Overview2/3 OK');
    expect(screen.getByRole('link', { name: /All 3 sites/ })).toHaveAttribute('href', '/sites');
    expect(screen.getByRole('link', { name: /Add site/ })).toHaveAttribute('href', '/sites/new');
  });

  it('Acknowledge removes the banner at once and the toast offers Undo (§21.1, §16.8, D-016)', async () => {
    let finish: (v: { ok: true; postsAt: string }) => void = () => {};
    ackAction.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    undoAction.mockResolvedValue({ ok: true });
    const view = renderView(data());
    const [bannerAck] = within(desktop()).getAllByRole('button', { name: 'Acknowledge' });
    await act(async () => {
      fireEvent.click(bannerAck!);
    });
    // at once, while the action runs
    expect(ackAction).toHaveBeenCalledWith('i-142');
    expect(screen.queryByText('MuvMi is DOWN — 19 min')).toBeNull();
    expect(screen.getByText('INC-0142 · Acked by Tao')).toBeInTheDocument();
    // the action's revalidation brings the server's acked row with its result
    const acked = data({
      sites: data().sites.map((s) =>
        s.incident
          ? { ...s, incident: { ...s.incident, state: 'acknowledged' as const, ackedBy: 'Tao' } }
          : s,
      ),
    });
    view.rerender(
      <>
        <OverviewView data={acked} ackAction={ackAction} undoAction={undoAction} />
        <Toaster />
      </>,
    );
    await act(async () => {
      finish({ ok: true, postsAt: new Date(NOW.getTime() + 10_000).toISOString() });
    });
    expect(screen.queryByText('MuvMi is DOWN — 19 min')).toBeNull();
    expect(screen.getByText('Acknowledged INC-0142 · escalation stopped')).toBeInTheDocument();
    expect(
      screen.getByText('Posting to Chat and email in 10 s — nothing is sent until then'),
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Undo · 10 s' }));
    });
    expect(undoAction).toHaveBeenCalledWith('i-142');
    expect(refresh).toHaveBeenCalled();
  });

  it('after an ack, a relapse to Unacked brings the banner back (code review S06b)', async () => {
    ackAction.mockResolvedValue({ ok: true, postsAt: new Date(NOW.getTime() + 10_000).toISOString() });
    const view = renderView(data());
    await act(async () => {
      fireEvent.click(within(desktop()).getAllByRole('button', { name: 'Acknowledge' })[0]!);
    });
    // Realtime later delivers the same incident unacked again (DOWN AGAIN, D-004)
    view.rerender(
      <>
        <OverviewView data={data()} ackAction={ackAction} undoAction={undoAction} />
        <Toaster />
      </>,
    );
    expect(screen.getAllByText('MuvMi is DOWN — 19 min').length).toBe(2);
  });

  it('focus moves to the Live issues heading when Acknowledge takes its button away (WCAG 2.4.3)', async () => {
    ackAction.mockReturnValue(new Promise(() => {}));
    renderView(data());
    const button = within(desktop()).getAllByRole('button', { name: 'Acknowledge' })[0]!;
    button.focus();
    await act(async () => {
      fireEvent.click(button);
    });
    expect(screen.getAllByRole('heading', { level: 2, name: 'Live issues' })[0]).toHaveFocus();
  });

  it('says what changed once, politely (Realtime updates without a reload)', () => {
    renderView(data());
    expect(screen.getByText('2 of 3 sites OK · 1 live issue · 1 unacknowledged DOWN')).toHaveAttribute(
      'aria-live',
      'polite',
    );
  });

  it('a thrown action (network) is treated as a refusal', async () => {
    ackAction.mockRejectedValue(new Error('fetch failed'));
    renderView(data());
    await act(async () => {
      fireEvent.click(within(desktop()).getAllByRole('button', { name: 'Acknowledge' })[0]!);
    });
    await act(async () => {});
    expect(screen.getAllByText('MuvMi is DOWN — 19 min').length).toBe(2);
    expect(screen.getByText(/Couldn’t reach the server/)).toBeInTheDocument();
  });

  it('a refused ack puts the banner back and says why', async () => {
    ackAction.mockResolvedValue({ ok: false, message: 'Someone else acknowledged it first.' });
    renderView(data());
    await act(async () => {
      fireEvent.click(within(desktop()).getAllByRole('button', { name: 'Acknowledge' })[0]!);
    });
    expect(screen.getAllByText('MuvMi is DOWN — 19 min').length).toBe(2);
    await act(async () => {});
    expect(screen.getByText('Someone else acknowledged it first.')).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it('a Viewer gets no Acknowledge and no Add site; the phone card reads Uptime 30 d', () => {
    renderView(data({ viewer: { id: 'u-mint', name: 'Mint', kind: 'viewer' } }));
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Add site/ })).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Open INC-0142' }).length).toBeGreaterThan(1);
    expect(screen.getByText('Uptime 30 d')).toBeInTheDocument();
  });

  it('nothing listed → "All N monitored sites OK" with the last full round', () => {
    renderView(data({ sites: [site('VOCA'), site('ORCA Thailand')], events: [] }));
    expect(screen.getAllByText('All 2 monitored sites OK')).toHaveLength(2);
    expect(
      screen.getByText('No open incidents, nothing muted, no location warnings · last full round 10:07:00'),
    ).toBeInTheDocument();
    expect(screen.getByText('Nothing needs you · last full round 10:07')).toBeInTheDocument();
    expect(screen.getByText('No incidents yet.')).toBeInTheDocument();
  });

  it('the Tier control filters the tiles only', () => {
    renderView(data());
    fireEvent.click(screen.getByRole('radio', { name: 'Tier 2' }));
    expect(
      within(screen.getByRole('list', { name: 'All monitored sites' })).getAllByRole('listitem'),
    ).toHaveLength(1);
    expect(
      screen.getByText('1 of 3 monitored sites (Tier 2) · 1 draft not monitored yet'),
    ).toBeInTheDocument();
  });
});
