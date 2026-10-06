import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncidentView } from '../view';
import { IncidentAckView } from './incident-ack-view';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const actions = vi.hoisted(() => ({ acknowledgeIncident: vi.fn(), undoAcknowledge: vi.fn() }));
vi.mock('../actions', () => actions);

const NOW = new Date('2026-09-25T03:07:41Z');
const base: IncidentView = {
  id: 'INC-0142',
  incidentId: 'i1',
  site: 'MuvMi',
  title: 'MuvMi is down',
  sub: '19 min · Tier 1 · Fri 25 Sep',
  state: 'unacked',
  severity: 'down',
  escalationLevel: 0,
  recovered: false,
  role: 'You’re the owner.',
  confirmedAt: '09:48:41',
  confirmedBy: 'Confirmed by 3 locations, 2 checks',
  cause: 'Timeout > 30 s (BKK, TYO) · HTTP 504 (SIN)',
  siteUrl: 'https://www.muvmi.example.test',
  ack: { kind: 'can-ack' },
  log: [{ at: '09:48', text: 'Confirmed down — 3 locations, 2 checks' }],
};
const renderView = (over: Partial<IncidentView> = {}) =>
  render(<IncidentAckView view={{ ...base, ...over }} viewerName="Arm" viewerEmail="arm@example.test" />);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('IncidentAckView (MobileAck)', () => {
  it('shows the board facts and one Acknowledge button for whoever may act', () => {
    renderView();
    expect(screen.getByRole('heading', { level: 1, name: 'MuvMi is down' })).toBeInTheDocument();
    expect(screen.getByText('Down')).toBeInTheDocument();
    expect(screen.getByText('Unacked')).toBeInTheDocument();
    expect(screen.getByText('INC-0142')).toBeInTheDocument();
    expect(screen.getByText('You’re the owner.')).toBeInTheDocument();
    expect(screen.getByText('Timeout > 30 s (BKK, TYO) · HTTP 504 (SIN)')).toBeInTheDocument();
    expect(screen.getByText('arm@example.test')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Visit site (opens in a new tab)' })).toHaveAttribute(
      'href',
      'https://www.muvmi.example.test',
    );
    // D-016: no escalation, client update or note controls until their slices.
    expect(screen.queryByText(/Escalation|Client update|Add note|Full incident/)).toBeNull();
  });

  it('acknowledges in one tap (the action re-renders the page itself)', async () => {
    actions.acknowledgeIncident.mockResolvedValue({ ok: true, postsAt: '2026-09-25T03:07:51Z' });
    renderView();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' })));
    expect(actions.acknowledgeIncident).toHaveBeenCalledWith('i1');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('moves focus to Undo after the ack, and back to Acknowledge after the undo (WCAG 2.4.3)', async () => {
    const { rerender } = renderView();
    rerender(
      <IncidentAckView view={{ ...base, ...acked() }} viewerName="Arm" viewerEmail="arm@example.test" />,
    );
    await act(async () => vi.advanceTimersByTime(0));
    expect(screen.getByRole('button', { name: /Undo/ })).toHaveFocus();
    rerender(<IncidentAckView view={base} viewerName="Arm" viewerEmail="arm@example.test" />);
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toHaveFocus();
  });

  it('keeps the live region mounted, empty until there is something to say', () => {
    renderView();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('says why an ack was refused', async () => {
    actions.acknowledgeIncident.mockResolvedValue({
      ok: false,
      message: 'This incident is no longer waiting for an acknowledgement.',
    });
    renderView();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' })));
    expect(screen.getByRole('alert')).toHaveTextContent('no longer waiting');
    expect(refresh).toHaveBeenCalled(); // show what the incident is now
  });

  const acked = (
    over: Partial<Extract<IncidentView['ack'], { kind: 'acked' }>> = {},
  ): Partial<IncidentView> => ({
    state: 'acknowledged',
    ack: {
      kind: 'acked',
      byName: 'Arm',
      byViewer: true,
      postsAt: '2026-09-25T03:07:51Z',
      windowOpen: true,
      notifies: true,
      posted: null,
      ...over,
    },
  });

  it('counts down the 10 s window with Undo, then waits for the post (spec §16.8, D-016)', async () => {
    renderView(acked());
    await act(async () => vi.advanceTimersByTime(0));
    expect(screen.getByText('Acknowledged as Arm')).toBeInTheDocument();
    expect(
      screen.getByText('Posting to Chat and email in 10 s — nothing is sent until then'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo · 10 s' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
    // Screen readers hear the phase once, not every second.
    const live = screen.getByRole('status');
    expect(live).toHaveTextContent('Posting to Chat and email in a few seconds — nothing is sent until then');

    await act(async () => vi.advanceTimersByTime(4_000));
    expect(screen.getByRole('button', { name: 'Undo · 6 s' })).toBeInTheDocument();
    expect(
      screen.getByText('Posting to Chat and email in 6 s — nothing is sent until then'),
    ).toBeInTheDocument();
    expect(live).toHaveTextContent('in a few seconds');

    await act(async () => vi.advanceTimersByTime(6_000));
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Posting to the Chat thread and email now');
    await act(async () => vi.advanceTimersByTime(2_000));
    expect(refresh).toHaveBeenCalled();
  });

  it('never offers Undo for a window that had closed when the page was rendered', async () => {
    renderView(acked({ windowOpen: false }));
    await act(async () => vi.advanceTimersByTime(0));
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Posting to the Chat thread and email now');
  });

  it('undoes inside the window', async () => {
    actions.undoAcknowledge.mockResolvedValue({ ok: true });
    renderView(acked());
    await act(async () => vi.advanceTimersByTime(0));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Undo/ })));
    expect(actions.undoAcknowledge).toHaveBeenCalledWith('i1');
  });

  it('shows another person’s ack without Undo, and where it was posted', () => {
    renderView(
      acked({ byViewer: false, posted: { at: '2026-09-25T03:07:51Z', to: 'the Chat thread + email' } }),
    );
    expect(screen.getByText('Acknowledged by Arm')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Posted to the Chat thread + email at 10:07:51');
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull();
  });

  it('says a muted incident’s ack posts nothing', () => {
    renderView(acked({ notifies: false }));
    expect(screen.getByRole('status')).toHaveTextContent('Nothing to post');
  });

  it('is read-only with who can act for roles that can’t acknowledge', () => {
    renderView({
      role: null,
      ack: {
        kind: 'read-only',
        title: 'Your role can’t acknowledge (Viewer)',
        description: 'mint@example.test can see this incident but not acknowledge it.',
        people: [{ name: 'Arm', duty: 'owner', status: 'Not acked', urgent: true }],
      },
      siteUrl: null,
    });
    expect(screen.getByText('Your role can’t acknowledge (Viewer)')).toBeInTheDocument();
    expect(screen.getByText('Arm — owner')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Visit site/ })).toBeNull();
  });

  it('keeps refreshing until the ack is posted, and says so when it takes longer', async () => {
    renderView(acked({ windowOpen: false, postsAt: '2026-09-25T03:07:40Z' }));
    await act(async () => vi.advanceTimersByTime(2_000));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Posting to the Chat thread and email now');
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole('status')).toHaveTextContent('Still sending — retried automatically');
  });

  it('says plainly when a page opened after the retries finds it still unposted', async () => {
    renderView(acked({ windowOpen: false, postsAt: '2026-09-25T02:50:00Z' }));
    await act(async () => vi.advanceTimersByTime(0));
    expect(screen.getByRole('status')).toHaveTextContent('Not confirmed as posted');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('shows a PROBLEM incident as Problem, and the escalation level', () => {
    renderView({ severity: 'problem', state: 'escalated', escalationLevel: 1, title: 'MuvMi has a problem' });
    expect(screen.getByText('Problem')).toBeInTheDocument();
    expect(screen.getByText('Escalated · L1')).toBeInTheDocument();
  });

  it('shows "Was down" once recovered', () => {
    renderView({ recovered: true, state: 'needs_root_cause', ack: { kind: 'closed' }, log: [] });
    expect(screen.getByText('Was down')).toBeInTheDocument();
    expect(screen.getByText('Needs root cause')).toBeInTheDocument();
    expect(screen.queryByText('LATEST')).toBeNull();
  });
});
