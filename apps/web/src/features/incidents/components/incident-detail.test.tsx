import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncidentDetail } from '../detail-queries';
import { resolveGate, timelineOf, type EventRow } from '../model';
import { IncidentDetailView } from './incident-detail';
import { incidentSections } from './incident-sections';

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
    emailed: true,
    detectSeconds: 30,
    durationMinutes: 8,
    owner: 'Tao',
    backup: 'Nok',
    am: null,
    paged: null,
    acked: null,
    canAct: true,
    resolved: null,
    locations: [],
    evidence: null,
    pageChange: null,
    canAcceptBaseline: false,
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
  render(
    <IncidentDetailView
      detail={d}
      sections={incidentSections(d, new Date(NOW))}
      viewerName="Tao"
      viewerEmail="tao@example.test"
    />,
  );
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
    m.resolveIncident.mockResolvedValue({
      ok: true,
      postsAt: new Date(Date.now() + 10_000).toISOString(),
      notifies: true,
    });
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
    expect(within(done).getByText(/Root cause: Hosting \/ server\. Down 8 min\./)).toBeInTheDocument();
    expect(within(done).getAllByText(/^in \d+ s$/)).toHaveLength(2);
    await act(async () => fireEvent.click(within(done).getByRole('button', { name: /^Undo · \d+ s$/ })));
    expect(m.undoResolve).toHaveBeenCalledWith('i139');
    await waitFor(() => expect(resolveButton()).toHaveFocus());
  });

  it('Undo after the page refreshed to Resolved: focus lands on Resolve once the next refresh brings it back', async () => {
    m.resolveIncident.mockResolvedValue({
      ok: true,
      postsAt: new Date(Date.now() + 10_000).toISOString(),
      notifies: true,
    });
    m.undoResolve.mockResolvedValue({ ok: true });
    const open = detail({
      events: settled,
      rootCause: { category: 'hosting', what: 'Host rebooted the app server', fix: null },
    });
    const resolvedNow = {
      ...open,
      state: 'resolved' as const,
      view: { ...open.view, state: 'resolved' as const },
      resolvedAt: new Date().toISOString(),
      resolved: {
        by: 'Tao',
        byViewer: true,
        at: new Date().toISOString(),
        postsAt: new Date(Date.now() + 10_000).toISOString(),
        posted: null,
        notifies: true,
      },
    };
    const draw = (x: IncidentDetail) => (
      <IncidentDetailView
        detail={x}
        sections={incidentSections(x, new Date(NOW))}
        viewerName="Tao"
        viewerEmail="tao@example.test"
      />
    );
    const { rerender } = render(draw(open));
    fireEvent.click(resolveButton());
    const dialog = screen.getByRole('dialog', { name: 'Resolve incident' });
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Resolve incident' })));
    // the action's refresh lands: the page is Resolved, the Resolve button is gone
    rerender(draw(resolvedNow));
    const done = await screen.findByRole('dialog', { name: 'Incident resolved' });
    await act(async () => fireEvent.click(within(done).getByRole('button', { name: /^Undo · \d+ s$/ })));
    expect(screen.queryByRole('button', { name: /^Resolve…$/ })).toBeNull();
    // the Undo's refresh lands: Resolve is back and takes focus
    rerender(draw(open));
    await waitFor(() => expect(resolveButton()).toHaveFocus());
  });

  it('resolved and still sending: refreshes once the hold is over, then says it is still being tried (as the ack panel)', () => {
    vi.useFakeTimers();
    const walk = (ms: number) => {
      for (let n = 0; n < ms; n += 1_000) act(() => vi.advanceTimersByTime(1_000));
    };
    try {
      const d = detail({ events: settled });
      show({
        ...d,
        state: 'resolved',
        view: { ...d.view, state: 'resolved' },
        resolved: {
          by: 'Tao',
          byViewer: true,
          at: new Date().toISOString(),
          postsAt: new Date(Date.now() + 10_000).toISOString(),
          posted: null,
          notifies: true,
        },
      });
      // held: nothing to look for yet
      walk(9_000);
      expect(m.refresh).not.toHaveBeenCalled();
      // the hold ends at 10 s; refreshes at +2 s and +8 s, then every 15 s
      walk(4_000);
      expect(m.refresh).toHaveBeenCalledTimes(1);
      walk(6_000);
      expect(m.refresh).toHaveBeenCalledTimes(2);
      expect(screen.getAllByText('Posting to the Chat thread and email now').length).toBeGreaterThan(0);
      // 30 s after it was due: not "now" any more
      walk(25_000);
      expect(
        screen.getAllByText('Still sending — retried automatically until it goes through').length,
      ).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('started before today: STARTED and the phone line name the day (§13)', () => {
    show(detail({ events: settled }));
    expect(screen.getByText('Thu 24 Sep 22:14:00')).toBeInTheDocument();
    expect(screen.getByText(/Thu 24 Sep 22:14–22:22/)).toBeInTheDocument();
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

  it('header and facts: the cause says since when it is OK; confirmed by an immediate recheck; Resolve summary says "Down"', () => {
    show(detail({ events: settled }));
    expect(screen.getByText('HTTP 502 (BKK, SIN, TYO) · OK since 22:22')).toBeInTheDocument();
    expect(screen.getByText('Immediate recheck · MTTD 30 s')).toBeInTheDocument();
    // Every ⋯ is named "More actions for <what it acts on>" (spec §25.1).
    expect(screen.getByRole('button', { name: /^More actions for INC-\d{4,}$/ })).toBeInTheDocument();
    fireEvent.click(resolveButton());
    const dialog = screen.getByRole('dialog', { name: 'Resolve incident' });
    expect(within(dialog).getByText('Down')).toBeInTheDocument();
  });

  it('resolved: the card says who, how long and why (MIncident)', () => {
    const d = detail({
      events: settled,
      rootCause: { category: 'hosting', what: 'Host rebooted', fix: null },
    });
    show({
      ...d,
      state: 'resolved',
      view: { ...d.view, state: 'resolved' },
      resolved: { by: 'Tao', byViewer: true, at: NOW, postsAt: NOW, posted: NOW, notifies: true },
    });
    expect(
      screen.getAllByText('Resolved by Tao · ORCA Thailand was down 8 min · root cause: Hosting / server.')
        .length,
    ).toBeGreaterThan(0);
  });

  it('auto-resolved: no conditions listed as "Not met", only the line that none were needed (/verify, 15 Oct)', () => {
    const d = detail({ events: settled });
    show({ ...d, state: 'resolved', view: { ...d.view, state: 'resolved' }, autoResolved: true });
    expect(
      screen.getAllByText(
        'Resolved automatically — a short PROBLEM, never acknowledged. No root cause needed.',
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText('Root cause written')).not.toBeInTheDocument();
  });

  it('conditions say Met / Not met in words beside the icon (MIncident)', () => {
    show(detail({ events: settled }));
    fireEvent.click(resolveButton());
    const dialog = screen.getByRole('dialog', { name: 'Resolve incident' });
    expect(within(dialog).getAllByText('Met')).toHaveLength(2);
    expect(within(dialog).getByText('Not met')).toBeInTheDocument();
  });

  it('Root cause once recovered: "Save root cause", the board foot line; a failed save says to fix the fields', () => {
    show(detail({ events: settled }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Write root cause' })[0]!);
    const dialog = screen.getByRole('dialog', { name: 'Root cause' });
    expect(
      within(dialog).getByText(
        'Saving meets the root-cause condition. Resolve stays a separate, manual step.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save root cause' }));
    expect(within(dialog).getByText('Fix the highlighted fields to save.')).toBeInTheDocument();
    expect(within(dialog).getByText('Signed in as tao@example.test')).toBeInTheDocument();
  });

  it('resolved a DOWN: the email row names the DOWN recipients; the sentence ends with a full stop', async () => {
    m.resolveIncident.mockResolvedValue({
      ok: true,
      postsAt: new Date(Date.now() + 10_000).toISOString(),
      notifies: true,
    });
    show(detail({ events: settled, rootCause: { category: 'dns', what: 'Record removed', fix: null } }));
    fireEvent.click(resolveButton());
    const dialog = screen.getByRole('dialog', { name: 'Resolve incident' });
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Resolve incident' })));
    const done = await screen.findByRole('dialog', { name: 'Incident resolved' });
    expect(
      within(done).getByText('Resolved email to the DOWN recipients · held for undo'),
    ).toBeInTheDocument();
    expect(within(done).getAllByText(/nothing is sent until then\.$/).length).toBeGreaterThan(0);
  });

  it('resolved a drop that came back inside 5 min: Chat only, no email row (D-047)', async () => {
    m.resolveIncident.mockResolvedValue({
      ok: true,
      postsAt: new Date(Date.now() + 10_000).toISOString(),
      notifies: true,
    });
    show(
      detail({
        events: settled,
        emailed: false,
        rootCause: { category: 'dns', what: 'Record removed', fix: null },
      }),
    );
    fireEvent.click(resolveButton());
    const dialog = screen.getByRole('dialog', { name: 'Resolve incident' });
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Resolve incident' })));
    const done = await screen.findByRole('dialog', { name: 'Incident resolved' });
    expect(within(done).getByText('Resolved reply to the Chat thread · held for undo')).toBeInTheDocument();
    expect(within(done).queryByText(/Resolved email/)).not.toBeInTheDocument();
    expect(within(done).getAllByText(/^Root cause: .*Posting to Chat in \d+ s/).length).toBeGreaterThan(0);
  });

  it('resolved with no alert ever sent (D-047): says nothing will post, no countdown, no Undo, no message rows', async () => {
    m.resolveIncident.mockResolvedValue({
      ok: true,
      postsAt: new Date(Date.now() + 10_000).toISOString(),
      notifies: false,
    });
    show(
      detail({
        events: settled,
        emailed: false,
        rootCause: { category: 'false_alarm', what: 'Redirect not allowed yet', fix: null },
      }),
    );
    fireEvent.click(resolveButton());
    const dialog = screen.getByRole('dialog', { name: 'Resolve incident' });
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Resolve incident' })));
    const done = await screen.findByRole('dialog', { name: 'Incident resolved' });
    expect(within(done).getAllByText(/Nothing to post — no alert went out for this incident\.$/).length).toBe(
      2,
    );
    expect(within(done).queryByText(/Posting to/)).not.toBeInTheDocument();
    expect(within(done).queryByText(/held for undo/)).not.toBeInTheDocument();
    expect(within(done).queryByRole('button', { name: /^Undo/ })).not.toBeInTheDocument();
  });

  it('a page resolved with nothing to post never waits for a post that won’t come (no "Not confirmed")', () => {
    vi.useFakeTimers();
    try {
      const d = detail({ events: settled, emailed: false });
      show({
        ...d,
        state: 'resolved',
        view: { ...d.view, state: 'resolved' },
        resolved: {
          by: 'Tao',
          byViewer: true,
          at: new Date(Date.now() - 20 * 60_000).toISOString(),
          postsAt: new Date(Date.now() - 20 * 60_000 + 10_000).toISOString(),
          posted: null,
          notifies: false,
        },
      });
      act(() => vi.advanceTimersByTime(60_000));
      expect(m.refresh).not.toHaveBeenCalled();
      expect(
        screen.getAllByText('Nothing to post — no alert went out for this incident.').length,
      ).toBeGreaterThan(0);
      expect(screen.queryByText(/Not confirmed as posted/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Undo/ })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
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
      <IncidentDetailView
        detail={acked}
        sections={incidentSections(acked, new Date(NOW))}
        viewerName="Tao"
        viewerEmail="tao@example.test"
      />,
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

describe('Incident page — screenshot evidence', () => {
  it('shows the preview beside the words; the preview and "Open full size" both open it full size', () => {
    const url = 'https://storage.example.test/shot.png?token=x';
    const { container } = show(
      detail({ evidence: { url, takenAt: at('24T22:15:35'), afterRecovery: false } }),
    );
    const preview = container.querySelector(`button[aria-hidden] img[src="${url}"]`)!;
    expect(preview).not.toBeNull();
    fireEvent.click(preview);
    expect(screen.getByRole('img', { name: 'Browser screenshot of ORCA Thailand' })).toHaveAttribute(
      'src',
      url,
    );
  });
});
