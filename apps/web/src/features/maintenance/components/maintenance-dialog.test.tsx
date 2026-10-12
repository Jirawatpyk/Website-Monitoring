import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PausableSite } from '../model';
import { MaintenanceDialog } from './maintenance-dialog';
import { PauseActions } from './pause-actions';

const actions = vi.hoisted(() => ({
  muteSite: vi.fn(async (_: unknown) => ({ ok: true as const })),
  scheduleMaintenance: vi.fn(async (_: unknown) => ({ ok: true as const })),
  loadAdminNames: vi.fn(async () => ['Tao']),
}));
vi.mock('../actions', () => actions);
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const muvmi: PausableSite = {
  id: 's-muvmi',
  name: 'MuvMi',
  tier: 1,
  owner: 'Arm',
  status: 'down',
  mutedUntil: null,
  openIncident: {
    id: 'i142',
    number: 142,
    state: 'escalated',
    level: 1,
    detectedAt: '2026-09-25T02:48:41Z',
    ackedBy: null,
  },
};
const taiwan: PausableSite = {
  id: 's-tw',
  name: 'Bangkok Airways – Taiwan',
  tier: 1,
  owner: 'Arm',
  status: 'ok',
  mutedUntil: null,
  openIncident: null,
};

const dialog = (over: Partial<Parameters<typeof MaintenanceDialog>[0]> = {}) =>
  render(
    <MaintenanceDialog
      open
      onClose={() => {}}
      sites={[taiwan, muvmi]}
      siteId="s-muvmi"
      kind="maintenance"
      isAdmin={false}
      viewerName="Arm"
      viewerEmail="arm@example.test"
      {...over}
    />,
  );

beforeEach(() => {
  actions.muteSite.mockClear();
  actions.scheduleMaintenance.mockClear();
});

describe('MaintenanceDialog (boards Maintenance, MMaintenance)', () => {
  it('Done-when 2: starting maintenance now on a DOWN site is blocked with the spec text and offers Mute', async () => {
    const user = userEvent.setup();
    dialog();
    const box = screen.getByRole('dialog', { name: 'Schedule maintenance' });
    await user.click(within(box).getByRole('radio', { name: 'Now' }));
    const alert = within(box).getByRole('alert');
    expect(alert).toHaveTextContent('MuvMi is DOWN now (INC-0142).');
    expect(alert).toHaveTextContent(
      'A window started now won’t hide this incident — it stays open and keeps counting. Mute the alerts instead, or schedule the window for later.',
    );
    await user.type(within(box).getByLabelText(/Reason/), 'Hotfix');
    expect(within(box).getByRole('button', { name: 'Start now' })).toBeDisabled();

    await user.click(within(alert).getAllByRole('button', { name: 'Mute instead' })[0]!);
    const mute = screen.getByRole('dialog', { name: 'Mute site' });
    expect(within(mute).getByRole('status')).toHaveTextContent(
      'Mute stops new alerts only — INC-0142 keeps escalating until someone acknowledges.',
    );
    await user.click(within(mute).getByRole('button', { name: 'Mute for 4 h' }));
    expect(actions.muteSite).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: 's-muvmi', reason: 'Hotfix' }),
    );
    expect(await within(mute).findByText('Muted · MuvMi')).toBeInTheDocument();
  });

  it('a site already muted: the guard says so and offers no second mute (staging verify)', async () => {
    const user = userEvent.setup();
    const until = new Date(Date.now() + 3_600_000);
    dialog({ sites: [{ ...muvmi, mutedUntil: until.toISOString() }] });
    const box = screen.getByRole('dialog', { name: 'Schedule maintenance' });
    await user.click(within(box).getByRole('radio', { name: 'Now' }));
    const alert = within(box).getByRole('alert');
    // "today 18:00", or "Mon 12 Oct 00:02" when now + 1 h crosses Bangkok midnight (CI at 23:02).
    expect(alert).toHaveTextContent(
      /Already muted until (today |[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} )?\d\d:\d\d — new alerts are held\./,
    );
    expect(within(alert).queryByRole('button', { name: 'Mute instead' })).not.toBeInTheDocument();
  });

  it('focus moves into the dialog when it opens, and to Done after a save (spec-check)', async () => {
    const user = userEvent.setup();
    dialog({ siteId: 's-tw', kind: 'mute' });
    const box = screen.getByRole('dialog', { name: 'Mute site' });
    await waitFor(() => expect(box.contains(document.activeElement)).toBe(true));
    await user.type(within(box).getByLabelText(/Reason/), 'Deploy');
    await user.click(within(box).getByRole('button', { name: /Mute for/ }));
    await waitFor(() => expect(within(box).getByRole('button', { name: 'Done' })).toHaveFocus());
  });

  it('a Responder’s window over 24 h offers only Later, and says why (§24.14)', async () => {
    const user = userEvent.setup();
    dialog({ siteId: 's-tw' });
    const box = screen.getByRole('dialog', { name: 'Schedule maintenance' });
    await user.click(within(box).getByRole('radio', { name: 'Now' }));
    await user.click(within(box).getAllByRole('radio', { name: '3 days' })[0]!);
    expect(within(box).queryByRole('radio', { name: 'Now' })).not.toBeInTheDocument();
    expect(within(box).getByRole('radio', { name: 'Later' })).toBeChecked();
    expect(
      within(box).getByText(
        'Over 24 h needs an Admin’s approval first, so it can’t start now — pick a date below',
      ),
    ).toBeInTheDocument();
    expect(within(box).getByLabelText('Start date')).toBeInTheDocument();
  });

  it('opened with no site picked, no other site’s incident shows (spec-check)', async () => {
    const user = userEvent.setup();
    const until = new Date(Date.now() + 3_600_000).toISOString();
    dialog({ siteId: '', sites: [{ ...muvmi, mutedUntil: until }, taiwan] });
    const box = screen.getByRole('dialog', { name: 'Schedule maintenance' });
    await user.click(within(box).getByRole('radio', { name: 'Now' }));
    expect(within(box).queryByText(/MuvMi is DOWN now/)).not.toBeInTheDocument();
    expect(within(box).queryByText('Starting this window ends the mute.')).not.toBeInTheDocument();
    expect(within(box).getByText(/^Choose a site and type a reason/)).toBeInTheDocument();
  });

  it('a mute on a site in maintenance is refused before the round trip (§23.10)', async () => {
    const user = userEvent.setup();
    dialog({ siteId: 's-tw', kind: 'mute', sites: [{ ...taiwan, status: 'maintenance' }] });
    const box = screen.getByRole('dialog', { name: 'Mute site' });
    await user.type(within(box).getByLabelText(/Reason/), 'Deploy');
    expect(
      within(box).getByText('The site is in maintenance — its alerts are already off.'),
    ).toBeInTheDocument();
    expect(within(box).getByRole('button', { name: /Mute for/ })).toBeDisabled();
  });

  it('Done-when 4: a Responder’s 3-day window says it waits for an Admin; an Admin is told no approval is needed', async () => {
    const user = userEvent.setup();
    const { unmount } = dialog({ siteId: 's-tw' });
    await user.click(screen.getByRole('radio', { name: 'Later' }));
    await user.click(screen.getAllByRole('radio', { name: '3 days' })[0]!);
    expect(screen.getByText('Needs an Admin’s approval')).toBeInTheDocument();
    // §24.9: the Admins it goes to are named before it is sent.
    expect(
      await screen.findByText(/^Tao gets a request now; it starts only if approved before /),
    ).toBeInTheDocument();
    unmount();
    dialog({ siteId: 's-tw', isAdmin: true });
    await user.click(screen.getByRole('radio', { name: 'Later' }));
    await user.click(screen.getAllByRole('radio', { name: '3 days' })[0]!);
    expect(screen.getByText('You’re an Admin — no approval needed')).toBeInTheDocument();
    expect(screen.queryByText('Needs an Admin’s approval')).not.toBeInTheDocument();
  });

  it('a mute offers at most 24 h', () => {
    dialog({ siteId: 's-tw', kind: 'mute' });
    expect(screen.getAllByRole('radio', { name: '24 h' })[0]).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: '3 days' })).not.toBeInTheDocument();
  });

  it('a reason is required before Schedule', async () => {
    const user = userEvent.setup();
    dialog({ siteId: 's-tw' });
    await user.click(screen.getByRole('radio', { name: 'Later' }));
    const schedule = screen.getByRole('button', { name: 'Schedule' });
    expect(schedule).toBeDisabled();
    expect(screen.getByText(/Required — type a reason to enable “Schedule”/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Reason/), 'Server migration');
    expect(schedule).toBeEnabled();
    await user.click(schedule);
    await waitFor(() => expect(actions.scheduleMaintenance).toHaveBeenCalledTimes(1));
    expect(actions.scheduleMaintenance.mock.calls[0]![0]).toMatchObject({
      siteId: 's-tw',
      reason: 'Server migration',
    });
  });

  it('a refusal from the server shows on the reason field', async () => {
    const user = userEvent.setup();
    actions.muteSite.mockResolvedValueOnce({
      ok: false,
      message: 'This site is already muted — end or edit that mute from Overview › Maintenance & mutes.',
    } as never);
    dialog({ siteId: 's-tw', kind: 'mute' });
    await user.type(screen.getByLabelText(/Reason/), 'deploy');
    await user.click(screen.getByRole('button', { name: 'Mute for 4 h' }));
    expect(await screen.findByText(/already muted/)).toBeInTheDocument();
  });

  it('Cancel returns focus to the button that opened it', async () => {
    const user = userEvent.setup();
    render(<PauseActions site={taiwan} isAdmin viewerName="Tao" viewerEmail="tao@example.test" />);
    const mute = screen.getByRole('button', { name: 'Mute' });
    await user.click(mute);
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(mute).toHaveFocus());
  });
});
