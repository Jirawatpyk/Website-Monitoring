import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PausableSite } from '../model';
import { MaintenanceDialog } from './maintenance-dialog';

// Maintenance STATE › Weekly · Admin / Weekly · Responder (spec §32.2): the Repeat control in the dialog.
const actions = vi.hoisted(() => ({
  muteSite: vi.fn(async (_: unknown) => ({ ok: true as const })),
  scheduleMaintenance: vi.fn(async (_: unknown) => ({ ok: true as const })),
  scheduleSeries: vi.fn(async (_: unknown) => ({
    ok: true as const,
    id: 's1',
    waiting: false,
    windows: ['2026-09-28T18:00:00Z'],
  })),
  loadAdminNames: vi.fn(async () => ['Tao']),
}));
vi.mock('../actions', () => actions);
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const tubtong: PausableSite = {
  id: '00000000-0000-4000-8000-0000000000a1',
  name: 'Tubtong',
  tier: 2,
  owner: 'Ploy',
  status: 'ok',
  mutedUntil: null,
  openIncident: null,
};
const dialog = (isAdmin: boolean) =>
  render(
    <MaintenanceDialog
      open
      onClose={() => {}}
      sites={[tubtong]}
      siteId={tubtong.id}
      kind="maintenance"
      isAdmin={isAdmin}
      viewerName={isAdmin ? 'Tao' : 'Ploy'}
      viewerEmail="x@example.test"
    />,
  );
const repeatWeekly = async (user: ReturnType<typeof userEvent.setup>) => {
  const group =
    screen.getAllByRole('radiogroup', { name: 'Repeat' })[0] ?? screen.getAllByLabelText('Repeat')[0]!;
  await user.click(within(group as HTMLElement).getByRole('radio', { name: 'Weekly' }));
};

beforeEach(() => actions.scheduleSeries.mockClear());

describe('the Repeat control (§32.2)', () => {
  it('Weekly hides Start now, shows the day chips and the summary; at least one day', async () => {
    const user = userEvent.setup();
    dialog(true);
    await repeatWeekly(user);
    expect(screen.getByRole('dialog', { name: 'Schedule repeating maintenance' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Now' })).not.toBeInTheDocument();
    const chips = screen.getAllByRole('button', { pressed: true });
    expect(chips).toHaveLength(1);
    await user.click(chips[0]!);
    expect(screen.getAllByText('Pick at least one day.').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Schedule series' })).toBeDisabled();
  });

  it('an Admin schedules the series: the rule, the time, the length, no end', async () => {
    const user = userEvent.setup();
    dialog(true);
    await repeatWeekly(user);
    await user.type(screen.getByRole('textbox', { name: /Reason/ }), 'WordPress plugin updates');
    await user.click(screen.getByRole('button', { name: 'Schedule series' }));
    await waitFor(() => expect(actions.scheduleSeries).toHaveBeenCalledTimes(1));
    expect(actions.scheduleSeries.mock.calls[0]![0]).toMatchObject({
      siteId: tubtong.id,
      rule: { freq: 'weekly' },
      startTime: '01:00',
      durationMin: 120,
      untilOn: null,
      reason: 'WordPress plugin updates',
    });
    expect(await screen.findByText('Series scheduled · Tubtong')).toBeInTheDocument();
  });

  it('a Responder asks for approval, told an Admin approves once', async () => {
    const user = userEvent.setup();
    dialog(false);
    await repeatWeekly(user);
    expect(screen.getByText('Needs an Admin’s approval')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask for approval' })).toBeInTheDocument();
  });
});
