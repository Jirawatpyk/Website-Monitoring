import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecurityData } from '../security-model';
import { SecurityPageView } from './security-page';

const actions = vi.hoisted(() => ({
  signOutEverywhere: vi.fn(),
  signOutOtherDevices: vi.fn(),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
vi.mock('../actions', () => actions);
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/settings/security' }));

// Fri 25 Sep 2026 10:08 Bangkok.
const NOW = '2026-09-25T03:08:00.000Z';
const TAO = '00000000-0000-4000-8000-000000000001';
const PLOY = '00000000-0000-4000-8000-000000000005';
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

const person = (id: string, name: string, role: 'admin' | 'responder') => ({
  id,
  name,
  email: `${name.toLowerCase()}@x`,
  role,
  chatLinked: true,
  lastActive: null,
});
const session = (id: string, userId: string, ua: string, current = false) => ({
  id,
  userId,
  userAgent: ua,
  createdAt: '2026-09-25T00:00:00Z',
  lastUsed: '2026-09-25T03:00:00Z',
  current,
});

const data: SecurityData = {
  viewerId: TAO,
  domains: ['dxt.test'],
  people: [person(TAO, 'Tao', 'admin'), person(PLOY, 'Ploy', 'responder')],
  invites: [],
  shifts: [{ id: 's', userId: PLOY, startsAt: '2026-09-21T02:00:00Z', endsAt: '2026-09-28T02:00:00Z' }],
  sessions: [
    session('a', TAO, MAC, true),
    session('b', TAO, IPHONE),
    session('c', PLOY, IPHONE),
    session('d', PLOY, MAC),
  ],
  names: { [TAO]: 'Tao', [PLOY]: 'Ploy' },
  entries: [],
  signOuts: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  actions.signOutEverywhere.mockResolvedValue({ ok: true, outcome: '2' });
  actions.signOutOtherDevices.mockResolvedValue({ ok: true, outcome: '1' });
});

describe('SecurityPageView (Security, MSecurity)', () => {
  it('someone else: the dialog lists their devices and warns they are on call', async () => {
    const user = userEvent.setup();
    render(<SecurityPageView data={data} now={NOW} />);
    const row = screen.getAllByRole('row').find((r) => within(r).queryByText('Ploy'))!;
    await user.click(within(row).getByRole('button', { name: /^Sign out all of / }));
    const dialog = await screen.findByRole('dialog', { name: 'Sign out Ploy everywhere?' });
    expect(within(dialog).getByText('Safari · iPhone')).toBeInTheDocument();
    expect(within(dialog).getByText('Ploy is on call until Mon 28 Sep 09:00')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Sign out 2 devices' }));
    await waitFor(() => expect(actions.signOutEverywhere).toHaveBeenCalledWith({ userId: PLOY }));
    expect(await screen.findByTestId('security-status')).toHaveTextContent(
      'Ploy signed out on 2 devices · logged',
    );
    // The row's button goes with the devices, so focus lands on the section heading.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /People and their sign-in/ })).toHaveFocus(),
    );
  });

  it('your own row: the other devices only; this browser stays', async () => {
    const user = userEvent.setup();
    render(<SecurityPageView data={data} now={NOW} />);
    await user.click(screen.getByRole('button', { name: 'Sign out other devices' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sign out your other devices?' });
    expect(
      within(dialog).getByText(
        'This browser (Chrome · macOS) stays signed in. The device below goes back to the Google sign-in.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText('Chrome · macOS')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Sign out 1 other device' }));
    await waitFor(() => expect(actions.signOutOtherDevices).toHaveBeenCalled());
  });

  it('a refusal stays in the dialog, and Cancel returns focus to the row’s button', async () => {
    actions.signOutEverywhere.mockResolvedValueOnce({
      ok: false,
      message: 'Only an Admin can change people’s access.',
    });
    const user = userEvent.setup();
    render(<SecurityPageView data={data} now={NOW} />);
    const row = screen.getAllByRole('row').find((r) => within(r).queryByText('Ploy'))!;
    await user.click(within(row).getByRole('button', { name: /^Sign out all of / }));
    const dialog = await screen.findByRole('dialog', { name: 'Sign out Ploy everywhere?' });
    await user.click(within(dialog).getByRole('button', { name: 'Sign out 2 devices' }));
    expect(await within(dialog).findByText('Only an Admin can change people’s access.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(within(row).getByRole('button', { name: /^Sign out all of / })).toHaveFocus());
  });

  it('phone: a card opens the person’s devices, view only (§35.6)', async () => {
    const user = userEvent.setup();
    render(<SecurityPageView data={data} now={NOW} />);
    await user.click(screen.getByRole('button', { name: /^Tao, Admin, 2 devices, .*Show devices$/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Tao' });
    expect(within(sheet).getByText('This device')).toBeInTheDocument();
    expect(within(sheet).getByText(/Signing someone out happens on a larger screen/)).toBeInTheDocument();
  });
});
