import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncidentDetail } from '../detail-queries';
import { resolveGate, timelineOf, type EventRow } from '../model';
import { IncidentDetailView } from './incident-detail';

const m = vi.hoisted(() => ({
  refresh: vi.fn(),
  resolveIncident: vi.fn(),
  saveRootCause: vi.fn(),
  undoResolve: vi.fn(),
  addNote: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock('@/components/use-live-refresh', () => ({ useLiveRefresh: () => true }));
vi.mock('../actions', () => ({
  acknowledgeIncident: vi.fn(),
  undoAcknowledge: vi.fn(),
  resolveIncident: m.resolveIncident,
  saveRootCause: m.saveRootCause,
  undoResolve: m.undoResolve,
  addNote: m.addNote,
}));

// INC-0139 ORCA Thailand (Resolve board) — test fixtures only (§21.11).
const NOW = '2026-09-25T03:08:00Z';
const at = (local: string) => new Date(`2026-09-${local}+07:00`).toISOString();
const names = new Map([['u-tao', 'Tao']]);
const nameOf = (id: string | null) => (id ? (names.get(id) ?? 'someone') : 'someone');

function detail(over: Partial<IncidentDetail> & { events?: EventRow[] } = {}): IncidentDetail {
  const { events = [], ...rest } = over;
  const base = {
    state: 'needs_root_cause' as const,
    recoveredAt: at('24T22:22:00'),
    rootCause: { category: null, what: null, fix: null },
  };
  const merged = { ...base, ...rest };
  return {
    view: {
      id: 'INC-0139',
      incidentId: 'i139',
      site: 'ORCA Thailand',
      title: 'ORCA Thailand is down',
      sub: '',
      state: merged.state,
      severity: 'down',
      escalationLevel: 0,
      recovered: !!merged.recoveredAt,
      role: 'You’re the owner.',
      confirmedLabel: 'Confirmed down',
      confirmedAt: '22:14:30',
      confirmedBy: 'Confirmed by 3 locations, 2 checks',
      cause: 'HTTP 502 (BKK, SIN, TYO)',
      siteUrl: 'https://orca.example.test',
      ack: { kind: 'closed' },
    },
    siteId: 's-orca',
    siteName: 'ORCA Thailand',
    tier: 2,
    trigger: 'hard_fail',
    triggerLabel: 'Hard fail',
    severity: 'down',
    escalationLevel: 0,
    startedAt: at('24T22:14:00'),
    detectedAt: at('24T22:14:30'),
    resolvedAt: null,
    autoResolved: false,
    detectSeconds: 30,
    durationMinutes: 8,
    owner: 'Tao',
    backup: 'Nok',
    am: null,
    acked: null,
    canAct: true,
    resolved: null,
    locations: [],
    evidence: null,
    ...merged,
    gate: resolveGate(
      {
        siteName: 'ORCA Thailand',
        state: merged.state,
        recoveredAt: merged.recoveredAt,
        clientUpdateRequired: false,
        clientUpdatedAt: null,
        rootCauseCategory: merged.rootCause.category,
      },
      events,
      nameOf,
    ),
    timeline: timelineOf(
      {
        severity: 'down',
        trigger: 'hard_fail',
        startedAt: at('24T22:14:00'),
        recoveredAt: merged.recoveredAt,
      },
      events,
      nameOf,
      new Date(NOW),
    ),
  };
}
const settled = [
  { type: 'ok_two_rounds', at: at('24T22:23:00'), actor_id: null, payload: { state: 'needs_root_cause' } },
];
const show = (d: IncidentDetail) =>
  render(<IncidentDetailView detail={d} viewerName="Tao" viewerEmail="tao@example.test" nowIso={NOW} />);
const resolveButton = () => screen.getAllByRole('button', { name: /^Resolve…$/ })[0]!;

beforeEach(() => vi.clearAllMocks());

describe('Incident page — Resolve (T10, D-033)', () => {
  it('still down: Resolve is disabled and the card says why', () => {
    show(detail({ state: 'acknowledged', recoveredAt: null }));
    expect(resolveButton()).toBeDisabled();
    expect(
      screen.getAllByText('Resolve locked · 1 of 3 met — ORCA Thailand is still down').length,
    ).toBeGreaterThan(0);
  });

  it('Needs root cause: Resolve opens the dialog; "Resolve incident" waits for a category and what happened', () => {
    show(detail({ events: settled }));
    fireEvent.click(resolveButton());
    const dialog = screen.getByRole('dialog', { name: 'Resolve incident' });
    expect(within(dialog).getByText('Before you can resolve')).toBeInTheDocument();
    const resolve = within(dialog).getByRole('button', { name: 'Resolve incident' });
    expect(resolve).toBeDisabled();
    expect(within(dialog).getByText('Choose a root cause category')).toBeInTheDocument();
  });

  it('a Viewer (or any role that can’t act) sees the conditions, no buttons', () => {
    show(detail({ events: settled, canAct: false }));
    expect(screen.queryByRole('button', { name: /^Resolve…$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add note' })).toBeNull();
    expect(screen.getAllByText('The owner, the backup or an Admin resolves it.').length).toBeGreaterThan(0);
  });

  it('resolved: Undo inside the window, then focus back on Resolve (WCAG 2.4.3)', async () => {
    m.resolveIncident.mockResolvedValue({ ok: true, postsAt: new Date(Date.now() + 10_000).toISOString() });
    m.undoResolve.mockResolvedValue({ ok: true });
    show(
      detail({
        events: settled,
        rootCause: { category: 'hosting', what: 'Host rebooted the app server', fix: null },
      }),
    );
    fireEvent.click(resolveButton());
    const dialog = screen.getByRole('dialog', { name: 'Resolve incident' });
    const resolve = within(dialog).getByRole('button', { name: 'Resolve incident' });
    expect(resolve).toBeEnabled();
    await act(async () => fireEvent.click(resolve));
    expect(m.resolveIncident).toHaveBeenCalledWith({
      incidentId: 'i139',
      category: 'hosting',
      what: 'Host rebooted the app server',
      fix: '',
    });
    const done = await screen.findByRole('dialog', { name: 'Incident resolved' });
    // the pressed button is gone: focus is on the outcome (WCAG 2.4.3)
    await waitFor(() => expect(within(done).getByText(/^Resolved at \d\d:\d\d by Tao$/)).toHaveFocus());
    expect(within(done).getByText(/Posting to Chat and email in \d+ s/)).toBeInTheDocument();
    await act(async () => fireEvent.click(within(done).getByRole('button', { name: /^Undo · \d+ s$/ })));
    expect(m.undoResolve).toHaveBeenCalledWith('i139');
    await waitFor(() => expect(resolveButton()).toHaveFocus());
  });

  it('a refusal stays in the dialog and says why', async () => {
    m.resolveIncident.mockResolvedValue({
      ok: false,
      message: 'It needs 2 OK rounds in a row before it can be resolved',
    });
    show(detail({ events: settled, rootCause: { category: 'dns', what: 'Record removed', fix: null } }));
    fireEvent.click(resolveButton());
    const dialog = screen.getByRole('dialog', { name: 'Resolve incident' });
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Resolve incident' })));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('It needs 2 OK rounds in a row');
  });

  it('Unknown saved earlier: the button reads "Save, keep open" and the warning shows', () => {
    show(detail({ events: settled, rootCause: { category: 'unknown', what: 'Still looking', fix: null } }));
    fireEvent.click(resolveButton());
    const dialog = screen.getByRole('dialog', { name: 'Resolve incident' });
    expect(within(dialog).queryByRole('button', { name: 'Resolve incident' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Save, keep open' })).toBeEnabled();
    expect(within(dialog).getAllByText('Unknown keeps the incident open').length).toBeGreaterThan(0);
  });
});

describe('Incident page — roles that can’t acknowledge (D-016)', () => {
  it('is read-only and says who can act; no Acknowledge', () => {
    const d = detail({ state: 'unacked', recoveredAt: null, canAct: false });
    show({
      ...d,
      view: {
        ...d.view,
        state: 'unacked',
        ack: {
          kind: 'read-only',
          title: 'Your role can’t acknowledge (Viewer)',
          description: 'mint@example.test can see this incident but not acknowledge it.',
          people: [{ name: 'Tao', duty: 'owner', status: 'Not acked', urgent: true }],
        },
      },
    });
    expect(screen.getByText('Your role can’t acknowledge (Viewer)')).toBeInTheDocument();
    expect(screen.getByText('Tao — owner')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
  });
});

describe('Incident page — acknowledge on desktop', () => {
  it('after the ack the header button goes: focus moves to Add note (WCAG 2.4.3)', () => {
    const d = detail({ state: 'unacked', recoveredAt: null });
    const unacked = {
      ...d,
      view: { ...d.view, state: 'unacked' as const, ack: { kind: 'can-ack' as const } },
    };
    const { rerender } = show(unacked);
    const acked = {
      ...unacked,
      state: 'acknowledged' as const,
      view: {
        ...unacked.view,
        state: 'acknowledged' as const,
        ack: {
          kind: 'acked' as const,
          byName: 'Tao',
          byViewer: true,
          postsAt: NOW,
          windowOpen: false,
          notifies: true,
          posted: null,
        },
      },
    };
    rerender(
      <IncidentDetailView detail={acked} viewerName="Tao" viewerEmail="tao@example.test" nowIso={NOW} />,
    );
    expect(screen.getAllByRole('button', { name: 'Add note' })[0]).toHaveFocus();
  });
});

describe('Incident page — notes', () => {
  it('Add note posts the trimmed text and closes', async () => {
    m.addNote.mockResolvedValue({ ok: true });
    show(detail({ events: settled }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Add note' })[0]!);
    const dialog = screen.getByRole('dialog', { name: 'Add a note' });
    const post = within(dialog).getByRole('button', { name: 'Post note' });
    expect(post).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Your note/), { target: { value: ' Host restarting ' } });
    await act(async () => fireEvent.click(post));
    expect(m.addNote).toHaveBeenCalledWith({ incidentId: 'i139', text: ' Host restarting ' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a note' })).toBeNull());
  });
});
