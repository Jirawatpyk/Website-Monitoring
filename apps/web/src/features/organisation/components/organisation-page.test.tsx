import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrganisationData } from '../queries';
import { OrganisationPageView } from './organisation-page';

const actions = vi.hoisted(() => ({ saveResponseHours: vi.fn() }));
const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
vi.mock('../actions', () => actions);
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/settings/organisation' }));

const data: OrganisationData = {
  hours: { days: 'Mon–Fri', from: '09:00', to: '18:00' },
  sites: [
    { name: 'MuvMi', tier: 1 },
    { name: 'Fuji Links', tier: 2 },
    { name: 'DxT AI', tier: 3 },
  ],
  clients: [{ name: 'MuvMi', internal: false, amName: 'Bua', language: 'th', sites: ['MuvMi'] }],
  storageBytes: 1.4 * 1024 ** 3,
};

beforeEach(() => {
  actions.saveResponseHours.mockReset();
  router.refresh.mockReset();
});

// The desktop editor's Selects (the phone shows the same hours as text, view only).
const editor = () =>
  screen.getByRole('heading', { name: 'Tier 2–3 · response hours' }).closest('div')!.parentElement!;

/** The editor's native selects, in the board's order (AURA Select keeps one under its listbox). */
const field = (name: 'Days' | 'From' | 'To') =>
  editor().querySelectorAll('select')[['Days', 'From', 'To'].indexOf(name)] as HTMLSelectElement;

describe('Organisation (S17, D-069)', () => {
  it('shows the tiers, the hours, the clients and the storage, with no Save bar until something changes', () => {
    render(<OrganisationPageView data={data} />);
    expect(screen.getByRole('heading', { name: 'Tier 1' })).toBeInTheDocument();
    expect(screen.getAllByText('Mon–Fri 09:00–18:00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bua').length).toBeGreaterThan(0);
    expect(screen.getByText('Database 1.4 GB of 8 GB')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).not.toBeInTheDocument();
  });

  it('“To” before “From” says so and keeps the dialog shut', async () => {
    const user = userEvent.setup();
    render(<OrganisationPageView data={data} />);
    await user.selectOptions(field('To'), '08:00');
    expect(within(editor()).getByText('Must be after From')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('the confirm needs a note, shows who it affects, saves and focuses the saved line', async () => {
    const user = userEvent.setup();
    actions.saveResponseHours.mockResolvedValue({ ok: true });
    render(<OrganisationPageView data={data} />);
    await user.selectOptions(field('Days'), 'Mon–Sat');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const dialog = await screen.findByRole('dialog', { name: 'Change response hours?' });
    expect(within(dialog).getByText('Affects 2 sites · 1 in Tier 2, 1 in Tier 3')).toBeInTheDocument();
    expect(within(dialog).getByText('Affects 1 site · MuvMi')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Save and log' }));
    expect(
      within(dialog).getByText('Add a short note — it goes in the audit log with the change'),
    ).toBeInTheDocument();
    expect(actions.saveResponseHours).not.toHaveBeenCalled();

    await user.type(within(dialog).getByRole('textbox', { name: /Change note/ }), 'Saturday cover');
    await user.click(within(dialog).getByRole('button', { name: 'Save and log' }));
    await waitFor(() =>
      expect(actions.saveResponseHours).toHaveBeenCalledWith({
        days: 'Mon–Sat',
        from: '09:00',
        to: '18:00',
        note: 'Saturday cover',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const line = screen.getByText(/^Saved — /);
    expect(line).toHaveTextContent('Saved — Mon–Sat 09:00–18:00 from the next engine run.');
    await waitFor(() => expect(line).toHaveFocus());
    expect(router.refresh).toHaveBeenCalled();
  });

  it('a refusal stays in the dialog', async () => {
    const user = userEvent.setup();
    actions.saveResponseHours.mockResolvedValue({
      ok: false,
      message: 'Only an Admin can change the response hours.',
    });
    render(<OrganisationPageView data={data} />);
    await user.selectOptions(field('From'), '08:30');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: /Change note/ }), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Save and log' }));
    expect(
      await within(dialog).findByText('Only an Admin can change the response hours.'),
    ).toBeInTheDocument();
  });
});
