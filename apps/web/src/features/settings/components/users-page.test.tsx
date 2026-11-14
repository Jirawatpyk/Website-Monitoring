import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsersData } from '../model';
import { UsersPageView } from './users-page';

const actions = vi.hoisted(() => ({
  inviteUser: vi.fn(),
  revokeInvite: vi.fn(),
  changeUserRole: vi.fn(),
  deactivateUser: vi.fn(),
  setChatId: vi.fn(),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
vi.mock('../actions', () => actions);
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/settings/users' }));
vi.mock('@/features/oncall', () => ({ HandOverDialog: () => null }));

// Fri 25 Sep 2026 10:08 Bangkok.
const NOW = '2026-09-25T03:08:00.000Z';
const NOK = '00000000-0000-4000-8000-000000000004';
const ARM = '00000000-0000-4000-8000-000000000002';
const TAO = '00000000-0000-4000-8000-000000000001';
const SITE = '00000000-0000-4000-8000-0000000000a1';

const data: UsersData = {
  viewerId: TAO,
  people: [
    { id: TAO, name: 'Tao', email: 'tao@x', role: 'admin', chatLinked: true, lastActive: NOW },
    { id: ARM, name: 'Arm', email: 'arm@x', role: 'responder', chatLinked: true, lastActive: null },
    { id: NOK, name: 'Nok', email: 'nok@x', role: 'responder', chatLinked: true, lastActive: null },
  ],
  invites: [{ email: 'new@x', role: 'admin', addedAt: '2026-09-24T02:12:00Z' }],
  sites: [{ id: SITE, name: 'realme.link', live: true, ownerId: NOK, backupId: ARM }],
  clients: [],
  rotation: [],
  shifts: [],
  swaps: [],
  acks: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  actions.changeUserRole.mockResolvedValue({ ok: true });
  actions.inviteUser.mockResolvedValue({ ok: true, outcome: 'invited' });
});

async function openMenu(name: string, item: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: `Actions for ${name}` }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
  return user;
}

describe('UsersPageView (Users, MUsers)', () => {
  it('the one-Admin banner names the pending Admin, never a link or expiry (D-062)', () => {
    render(<UsersPageView data={data} oncall={null} now={NOW} />);
    expect(screen.getByText('1 active Admin — monitor-fault alerts reach only Tao')).toBeInTheDocument();
    expect(screen.getByText('new@x was added as an Admin but hasn’t signed in yet.')).toBeInTheDocument();
    expect(screen.queryByText(/expires|2-step/i)).toBeNull();
  });

  it('a role change waits for every pick, then sends them (Done-when 2)', async () => {
    render(<UsersPageView data={data} oncall={null} now={NOW} />);
    const user = await openMenu('Nok', 'Change role…');
    const dialog = await screen.findByRole('dialog', { name: 'Change Nok’s role' });
    expect(within(dialog).getByText('Owner of 1 site')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Change to Viewer' }));
    expect(actions.changeUserRole).not.toHaveBeenCalled();
    expect(
      within(dialog)
        .getAllByText('Pick a person')
        .filter((e) => e.tagName !== 'OPTION').length,
    ).toBeGreaterThan(0);

    // realme.link's owner pick: the native select that offers people (the other is New role).
    const select = [...dialog.querySelectorAll('select')].find((s) =>
      [...s.options].some((o) => o.value === TAO),
    );
    expect(select).toBeTruthy();
    await user.selectOptions(select!, TAO);
    await user.click(within(dialog).getByRole('button', { name: 'Change to Viewer' }));
    await waitFor(() =>
      expect(actions.changeUserRole).toHaveBeenCalledWith({
        userId: NOK,
        role: 'viewer',
        reassign: { owners: { [SITE]: TAO } },
      }),
    );
    expect(await screen.findByTestId('users-count')).toHaveTextContent(
      'Nok is now Viewer · reassignments applied · logged',
    );
  });

  it('focus goes back to the row’s ⋯ when the dialog closes', async () => {
    render(<UsersPageView data={data} oncall={null} now={NOW} />);
    const user = await openMenu('Nok', 'Edit Chat id…');
    const dialog = await screen.findByRole('dialog', { name: 'Nok’s Google Chat id' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Actions for Nok' })[0]).toHaveFocus());
  });

  it('the invite dialog asks for the primary address and reminds about 2-Step (D-007)', async () => {
    render(<UsersPageView data={data} oncall={null} now={NOW} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Invite user' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add someone to Monitor' });
    expect(
      within(dialog).getByText('The person’s primary Google address — not a DxT alias.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/2-Step Verification page/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add to access list' }));
    expect(actions.inviteUser).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText(/Primary Google address/), 'Someone@X');
    await user.click(within(dialog).getByRole('button', { name: 'Add to access list' }));
    await waitFor(() =>
      expect(actions.inviteUser).toHaveBeenCalledWith({ email: 'Someone@X', role: 'responder' }),
    );
  });

  it('phone: a card opens the person’s sheet (§35.3)', async () => {
    render(<UsersPageView data={data} oncall={null} now={NOW} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Nok, Responder, .*Show details$/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Nok' });
    expect(within(sheet).getByText('Owner of 1 — realme.link')).toBeInTheDocument();
    expect(within(sheet).getByText('Roles and reassignments change on a larger screen.')).toBeInTheDocument();
  });
});
