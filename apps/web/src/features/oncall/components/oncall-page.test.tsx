import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OncallData, ShiftRow, SwapRow, SwapStatus } from '../model';
import { OncallPageView } from './oncall-page';

const actions = vi.hoisted(() => ({
  saveRotation: vi.fn(async (_: unknown) => ({ ok: true as const })),
  requestSwap: vi.fn(async (_: unknown) => ({ ok: true as const, id: 'w-new' })),
  respondSwap: vi.fn(async (_: unknown) => ({ ok: true as const })),
  decideSwap: vi.fn(async (_: unknown) => ({ ok: true as const })),
  withdrawSwap: vi.fn(async (_: unknown) => ({ ok: true as const })),
  handOver: vi.fn(async (_: unknown) => ({ ok: true as const })),
  setChecklist: vi.fn(async (_: unknown) => ({ ok: true as const })),
  sendTest: vi.fn(async () => ({ ok: true as const, at: '2026-09-25T03:08:00Z' })),
  confirmTest: vi.fn(
    async (
      _: unknown,
    ): Promise<{ ok: true; at: string } | { ok: false; message: string; code?: string }> => ({
      ok: true,
      at: '2026-09-25T03:08:00Z',
    }),
  ),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
vi.mock('../actions', () => actions);
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const NOW = '2026-09-25T03:07:00.000Z';
const mon = (day: number) => new Date(Date.UTC(2026, 8, day, 2, 0)).toISOString();
const shift = (id: string, userId: string, start: number): ShiftRow => ({
  id,
  userId,
  startsAt: mon(start),
  endsAt: mon(start + 7),
  handedOverFrom: null,
});
const SHIFTS = [
  shift('arm14', 'arm', 14),
  shift('ploy21', 'ploy', 21),
  shift('nok28', 'nok', 28),
  shift('arm5', 'arm', 35),
  shift('ploy12', 'ploy', 42),
  shift('nok19', 'nok', 49),
];
function data(viewer: 'tao' | 'arm' | 'nok' | 'ploy', over: Partial<OncallData> = {}): OncallData {
  return {
    nowIso: NOW,
    viewer: {
      id: viewer,
      name: viewer[0]!.toUpperCase() + viewer.slice(1),
      role: viewer === 'tao' ? 'admin' : 'responder',
    },
    names: { tao: 'Tao', arm: 'Arm', ploy: 'Ploy', nok: 'Nok' },
    admins: ['tao'],
    eligible: ['arm', 'nok', 'ploy', 'tao'],
    rotation: ['arm', 'ploy', 'nok'],
    shifts: SHIFTS,
    swaps: [],
    focus: null,
    handoverReasons: {},
    checklists: {},
    owners: [{ id: 'arm', sites: ['MuvMi'] }],
    tier1Sites: 5,
    paged: [],
    hours: { startMin: 540, endMin: 1080, days: [1, 2, 3, 4, 5], holidays: [] },
    ...over,
  };
}
const swap = (status: SwapStatus): SwapRow => ({
  id: 'w1',
  status,
  requesterId: 'arm',
  counterpartId: 'nok',
  requesterShiftId: 'arm5',
  counterpartShiftId: 'nok19',
  createdAt: '2026-09-22T03:12:00Z',
  respondedAt: status === 'accepted' ? '2026-09-25T03:07:00Z' : null,
  decidedAt: null,
  decidedBy: null,
  updatedAt: '2026-09-22T03:12:00Z',
  requesterWeek: { start: mon(35), end: mon(42) },
  counterpartWeek: { start: mon(49), end: mon(56) },
});
const withSwap = (viewer: 'tao' | 'arm' | 'nok', status: SwapStatus) => {
  const w = swap(status);
  return data(viewer, {
    swaps: [w],
    focus: { swap: w, notes: { reason: 'Family trip', responseNote: null, decisionNote: null } },
  });
};
/** The desktop half of the page (OnCall): the phone half (MOnCall) is in the same tree, hidden by CSS. */
const visible = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]!;

beforeEach(() => vi.clearAllMocks());

describe('OncallPageView', () => {
  it('shows tonight’s person, the rotation and an Admin’s Edit rotation; focus comes back after Cancel', async () => {
    const user = userEvent.setup();
    render(<OncallPageView data={data('tao')} testToken={null} />);
    expect(screen.getAllByText('ON CALL TONIGHT')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Mon 21 Sep → Mon 28 Sep')[0]).toBeInTheDocument();
    const edit = visible('Edit rotation');
    await user.click(edit);
    const dialog = await screen.findByRole('dialog', { name: 'Edit rotation' });
    expect(within(dialog).getByText('No change yet')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(edit).toHaveFocus());
  });

  it('saves a new order and says who hears about it', async () => {
    const user = userEvent.setup();
    render(<OncallPageView data={data('tao')} testToken={null} />);
    await user.click(visible('Edit rotation'));
    const dialog = await screen.findByRole('dialog', { name: 'Edit rotation' });
    await user.click(within(dialog).getByRole('button', { name: 'Move Ploy up' }));
    expect(
      within(dialog).getByText('Ploy, Arm and Nok get a Chat message with their new weeks · logged'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save rotation' }));
    await waitFor(() =>
      expect(actions.saveRotation).toHaveBeenCalledWith({ userIds: ['ploy', 'arm', 'nok'] }),
    );
    expect(router.refresh).toHaveBeenCalled();
  });

  it('lets the person asked accept, and keeps the page on that request (§27.3)', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<OncallPageView data={withSwap('nok', 'waiting')} testToken={null} />);
    expect(screen.getAllByText('Arm asks you to swap weeks')[0]).toBeInTheDocument();
    await user.click(visible('Accept'));
    await waitFor(() => expect(actions.respondSwap).toHaveBeenCalledWith({ swapId: 'w1', accept: true }));
    expect(router.replace).toHaveBeenCalledWith('/oncall?swap=w1', { scroll: false });
    // The refresh brings the accepted request: Accept is gone, focus is on what it says now.
    rerender(<OncallPageView data={withSwap('nok', 'accepted')} testToken={null} />);
    await waitFor(() =>
      expect(document.activeElement?.textContent).toContain('Accepted · waiting for an Admin to approve'),
    );
  });

  it('puts focus on the closed request after an Admin declines it', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<OncallPageView data={withSwap('tao', 'accepted')} testToken={null} />);
    await user.click(visible('Decline'));
    const dialog = await screen.findByRole('dialog', { name: 'Decline Arm’s swap with Nok?' });
    await user.click(within(dialog).getByLabelText(/Reason/));
    await user.paste('Two weeks in a row');
    await user.click(within(dialog).getByRole('button', { name: 'Decline swap' }));
    await waitFor(() => expect(actions.decideSwap).toHaveBeenCalled());
    const declined: SwapRow = {
      ...swap('admin_declined'),
      decidedBy: 'tao',
      decidedAt: '2026-09-25T03:08:00Z',
    };
    rerender(
      <OncallPageView
        data={data('tao', { swaps: [declined], focus: { swap: declined, notes: null } })}
        testToken={null}
      />,
    );
    await waitFor(() =>
      expect(document.activeElement?.textContent).toContain('This request is closed — You declined'),
    );
  });

  it('keeps Approve off until the person asked accepts (§27.6)', async () => {
    const { unmount } = render(<OncallPageView data={withSwap('tao', 'waiting')} testToken={null} />);
    expect(visible('Approve')).toBeDisabled();
    unmount();
    const user = userEvent.setup();
    render(<OncallPageView data={withSwap('tao', 'accepted')} testToken={null} />);
    await user.click(visible('Approve'));
    await waitFor(() => expect(actions.decideSwap).toHaveBeenCalledWith({ swapId: 'w1', approve: true }));
  });

  it('needs an Admin’s reason to decline, and sends it', async () => {
    const user = userEvent.setup();
    render(<OncallPageView data={withSwap('tao', 'accepted')} testToken={null} />);
    await user.click(visible('Decline'));
    const dialog = await screen.findByRole('dialog', { name: 'Decline Arm’s swap with Nok?' });
    await user.click(within(dialog).getByRole('button', { name: 'Decline swap' }));
    expect(within(dialog).getByText('Say why — Arm and Nok see this')).toBeInTheDocument();
    expect(actions.decideSwap).not.toHaveBeenCalled();
    await user.click(within(dialog).getByLabelText(/Reason/));
    await user.paste('Nok would be on call two weeks in a row');
    await user.click(within(dialog).getByRole('button', { name: 'Decline swap' }));
    await waitFor(() =>
      expect(actions.decideSwap).toHaveBeenCalledWith({
        swapId: 'w1',
        approve: false,
        note: 'Nok would be on call two weeks in a row',
      }),
    );
  });

  it('lets the requester withdraw', async () => {
    const user = userEvent.setup();
    render(<OncallPageView data={withSwap('arm', 'waiting')} testToken={null} />);
    await user.click(visible('Withdraw'));
    await waitFor(() => expect(actions.withdrawSwap).toHaveBeenCalledWith({ swapId: 'w1' }));
  });

  it('asks for a swap on your own week and opens the request it made', async () => {
    const user = userEvent.setup();
    render(<OncallPageView data={data('arm')} testToken={null} />);
    await user.click(visible('Swap'));
    const dialog = await screen.findByRole('dialog', { name: 'Swap Arm’s week · Mon 5 Oct → Mon 12 Oct' });
    await user.click(within(dialog).getByRole('button', { name: 'Send swap request' }));
    await waitFor(() =>
      expect(actions.requestSwap).toHaveBeenCalledWith({ shiftId: 'arm5', withShiftId: 'ploy12' }),
    );
    expect(router.replace).toHaveBeenCalledWith('/oncall?swap=w-new', { scroll: false });
  });

  it('confirms the test link once the page is up, then drops it from the address (§27.8)', async () => {
    render(<OncallPageView data={data('ploy')} testToken="00000000-0000-4000-8000-0000000000f1" />);
    expect(await screen.findByText('Test alert received on this phone at 10:08')).toBeInTheDocument();
    expect(actions.confirmTest).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/oncall', { scroll: false });
  });

  it('says whose test it was when someone else opens the link', async () => {
    actions.confirmTest.mockResolvedValueOnce({
      ok: false,
      message: 'This test was for Ploy — open it on Ploy’s phone.',
      code: 'test_other_person',
    });
    render(<OncallPageView data={data('tao')} testToken="00000000-0000-4000-8000-0000000000f1" />);
    expect(await screen.findByText('This test was for Ploy — open it on Ploy’s phone.')).toBeInTheDocument();
    expect(
      screen.getByText('Opening it here doesn’t tick anything on Ploy’s checklist.'),
    ).toBeInTheDocument();
  });

  it.each([
    ['tao', 'Add the people who take Tier 1 nights and weekends, one week each.'],
    ['nok', 'An Admin sets up the rotation.'],
  ] as const)('shows %s an empty rotation (§28.4)', (who, text) => {
    render(<OncallPageView data={data(who, { shifts: [], rotation: [] })} testToken={null} />);
    expect(screen.getAllByText('No rotation yet')[0]).toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getAllByText('Tonight · site owners')[0]).toBeInTheDocument();
  });

  it('turns Swap off with its reason when the rotation has one person (§28.4)', () => {
    render(
      <OncallPageView
        data={data('ploy', { rotation: ['ploy'], shifts: SHIFTS.map((s) => ({ ...s, userId: 'ploy' })) })}
        testToken={null}
      />,
    );
    const swaps = screen.getAllByRole('button', { name: 'Swap' });
    expect(swaps.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(swaps[0]).toHaveAttribute('title', 'Nobody else in the rotation to swap with');
    expect(screen.getAllByText('Nobody else in the rotation to swap with').length).toBeGreaterThan(0);
  });

  it('sends a test alert to me and ticks the checklist (MOnCall)', async () => {
    const user = userEvent.setup();
    render(<OncallPageView data={data('ploy')} testToken={null} />);
    await user.click(visible('Send test alert to me'));
    await waitFor(() => expect(actions.sendTest).toHaveBeenCalled());
    await user.click(screen.getByRole('checkbox', { name: 'Alerts Space: notify for @mentions only' }));
    await waitFor(() =>
      expect(actions.setChecklist).toHaveBeenCalledWith({ mentionsOnly: true, dndAllowed: false }),
    );
  });
});
