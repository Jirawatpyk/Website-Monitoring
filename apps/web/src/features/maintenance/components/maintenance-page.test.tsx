import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WindowRow } from '../page-model';
import { MaintenancePageView } from './maintenance-page';

const actions = vi.hoisted(() => ({
  approveMaintenance: vi.fn(async (_: unknown) => ({ ok: true as const })),
  declineMaintenance: vi.fn(async (_: unknown) => ({ ok: true as const })),
  endWindowEarly: vi.fn(async (_: unknown) => ({ ok: true as const })),
  editWindowEnd: vi.fn(async (_: unknown) => ({ ok: true as const })),
  cancelWindow: vi.fn(async (_: unknown) => ({ ok: true as const })),
  withdrawRequest: vi.fn(async (_: unknown) => ({ ok: true as const })),
  muteSite: vi.fn(async (_: unknown) => ({ ok: true as const })),
  scheduleMaintenance: vi.fn(async (_: unknown) => ({ ok: true as const })),
}));
vi.mock('../actions', () => actions);
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/components/use-live-refresh', () => ({ useLiveRefresh: () => true }));

const NOW = '2026-09-25T03:07:00.000Z';
const bkk = (iso: string) => new Date(`${iso}+07:00`).toISOString();
const base: WindowRow = {
  id: 'w1',
  siteId: 's1',
  siteName: 'WeCare Studio',
  tier: 2,
  siteStatus: 'maintenance',
  kind: 'maintenance',
  startsAt: bkk('2026-09-25T09:30:00'),
  endsAt: bkk('2026-09-25T14:00:00'),
  approvedAt: bkk('2026-09-24T16:05:00'),
  approvedById: 'u-nok',
  endedAt: null,
  cancelledAt: null,
  createdAt: bkk('2026-09-24T16:05:00'),
  createdById: 'u-nok',
  outcome: null,
  outcomeDetail: null,
  reason: 'CMS upgrade',
  endReason: null,
  byName: 'Nok',
  ownerName: 'Nok',
  backupName: 'Ploy',
  ownerIds: ['u-nok', 'u-ploy'],
  log: [],
};
const request: WindowRow = {
  ...base,
  id: 'w3',
  siteId: 's3',
  siteName: 'Bangkok Airways – China',
  siteStatus: 'ok',
  startsAt: bkk('2026-09-26T22:00:00'),
  endsAt: bkk('2026-09-29T22:00:00'),
  approvedAt: null,
  approvedById: null,
  createdById: 'u-arm',
  byName: 'Arm',
  reason: 'Move to a new hosting provider',
};

const view = (role: 'admin' | 'responder' | 'readonly', rows = [base, request]) =>
  render(
    <MaintenancePageView
      rows={rows}
      sites={[]}
      viewer={{ id: role === 'admin' ? 'u-tao' : 'u-arm', name: role === 'admin' ? 'Tao' : 'Arm', role }}
      viewerEmail="x@example.test"
      nowIso={NOW}
    />,
  );

beforeEach(() => Object.values(actions).forEach((a) => a.mockClear()));

describe('MaintenancePageView (board MaintenancePage)', () => {
  it('the header, sections and the Admin’s row actions', () => {
    view('admin');
    expect(screen.getByRole('heading', { level: 1, name: 'Maintenance & mutes' })).toBeInTheDocument();
    expect(screen.getByText('1 active · 1 waiting for approval')).toBeInTheDocument();
    const waiting = screen.getByRole('region', { name: 'Waiting for approval' });
    expect(within(waiting).getAllByRole('button', { name: 'Approve' }).length).toBeGreaterThan(0);
    const active = screen.getByRole('region', { name: 'Active now' });
    expect(within(active).getAllByRole('button', { name: 'End now' }).length).toBeGreaterThan(0);
  });

  it('Approve asks first, then approves; focus goes back to the button', async () => {
    const user = userEvent.setup();
    view('admin');
    const approve = within(screen.getByRole('region', { name: 'Waiting for approval' })).getAllByRole(
      'button',
      {
        name: 'Approve',
      },
    )[0]!;
    await user.click(approve);
    const confirm = await screen.findByRole('dialog', { name: 'Approve 3 days of maintenance?' });
    await user.click(within(confirm).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(approve).toHaveFocus());
    await user.click(approve);
    await user.click(
      within(await screen.findByRole('dialog', { name: /Approve 3 days/ })).getByRole('button', {
        name: 'Approve',
      }),
    );
    await waitFor(() =>
      expect(actions.approveMaintenance).toHaveBeenCalledWith({ windowId: 'w3', endsAt: request.endsAt }),
    );
  });

  it('Decline and End now need a reason', async () => {
    const user = userEvent.setup();
    view('admin');
    await user.click(
      within(screen.getByRole('region', { name: 'Waiting for approval' })).getAllByRole('button', {
        name: 'Decline',
      })[0]!,
    );
    const decline = await screen.findByRole('dialog', { name: 'Decline Arm’s request?' });
    expect(within(decline).getByRole('button', { name: 'Decline request' })).toBeDisabled();
    await user.type(within(decline).getByLabelText(/Reason/), 'Split it into two nights');
    await user.click(within(decline).getByRole('button', { name: 'Decline request' }));
    await waitFor(() =>
      expect(actions.declineMaintenance).toHaveBeenCalledWith({
        windowId: 'w3',
        reason: 'Split it into two nights',
      }),
    );

    await user.click(
      within(screen.getByRole('region', { name: 'Active now' })).getAllByRole('button', {
        name: 'End now',
      })[0]!,
    );
    const end = await screen.findByRole('dialog', { name: 'End WeCare Studio maintenance now?' });
    expect(within(end).getByRole('button', { name: 'End maintenance now' })).toBeDisabled();
    await user.type(within(end).getByLabelText(/Reason for ending early/), 'Done early');
    await user.click(within(end).getByRole('button', { name: 'End maintenance now' }));
    await waitFor(() =>
      expect(actions.endWindowEarly).toHaveBeenCalledWith({ windowId: 'w1', reason: 'Done early' }),
    );
  });

  it('the asker withdraws a request; a running window has no Cancel', async () => {
    const user = userEvent.setup();
    view('responder', [{ ...base, ownerIds: ['u-arm'] }, request]);
    // Arm asked but no longer owns the site: withdraw only, no end to edit (edit_window_end refuses).
    const waiting = within(screen.getByRole('region', { name: 'Waiting for approval' }));
    expect(waiting.queryByRole('button', { name: 'Edit / withdraw' })).not.toBeInTheDocument();
    await user.click(waiting.getAllByRole('button', { name: 'Withdraw request…' })[0]!);
    const edit = await screen.findByRole('dialog', { name: /Edit or withdraw/ });
    expect(within(edit).queryByLabelText('Ends')).not.toBeInTheDocument();
    await user.type(within(edit).getByLabelText(/Reason for the change/), 'Not needed');
    await user.click(within(edit).getByRole('button', { name: 'Withdraw request' }));
    await waitFor(() =>
      expect(actions.withdrawRequest).toHaveBeenCalledWith({ windowId: 'w3', reason: 'Not needed' }),
    );

    await user.click(
      within(screen.getByRole('region', { name: 'Active now' })).getAllByRole('button', {
        name: 'Edit end',
      })[0]!,
    );
    const change = await screen.findByRole('dialog', { name: /Change end · WeCare Studio maintenance/ });
    expect(within(change).queryByRole('button', { name: /Cancel maintenance/ })).not.toBeInTheDocument();
  });

  it('read only: no actions, no Schedule button; the empty state', () => {
    const { unmount } = view('readonly');
    expect(screen.queryByRole('button', { name: 'End now' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Schedule maintenance or mute/ })).not.toBeInTheDocument();
    unmount();
    view('admin', []);
    expect(screen.getByText('Nothing active or scheduled')).toBeInTheDocument();
    expect(screen.getByText('Nothing active, scheduled or waiting')).toBeInTheDocument();
  });

  it('from the phone sheet, Keep it goes back to the sheet (MMaintenanceList Back)', async () => {
    const user = userEvent.setup();
    view('admin');
    await user.click(screen.getByRole('button', { name: /WeCare Studio, Maintenance/ }));
    const sheet = await screen.findByRole('dialog', { name: 'WeCare Studio' });
    await user.click(within(sheet).getByRole('button', { name: 'End maintenance now' }));
    const end = await screen.findByRole('dialog', { name: 'End WeCare Studio maintenance now?' });
    await user.click(within(end).getByRole('button', { name: 'Keep it' }));
    expect(await screen.findByRole('dialog', { name: 'WeCare Studio' })).toBeInTheDocument();
  });

  it('a phone row opens its sheet with the facts and the allowed actions', async () => {
    const user = userEvent.setup();
    view('admin');
    await user.click(screen.getByRole('button', { name: /Bangkok Airways – China, Needs approval/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Bangkok Airways – China' });
    expect(within(sheet).getByText('Move to a new hosting provider')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });
});
