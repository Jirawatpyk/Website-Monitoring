import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EscalationPageData } from '../types';
import { EscalationEditor } from './escalation-editor';
import { EscalationView } from './escalation-view';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh, replace: vi.fn() }) }));
const actions = vi.hoisted(() => ({ saveEscalation: vi.fn() }));
vi.mock('../actions', () => actions);

const l0 = {
  level: 0,
  delayMin: 0,
  targets: ['owner' as const],
  channels: ['chat' as const, 'space' as const, 'email' as const],
};
const l1 = {
  level: 1,
  delayMin: 15,
  targets: ['backup' as const, 'admins' as const],
  channels: ['chat' as const, 'email' as const],
};
const data: EscalationPageData = {
  policies: [
    { id: '00000000-0000-4000-8000-000000000001', key: 't1', severity: 'down', tier: 1, steps: [l0, l1] },
    { id: '00000000-0000-4000-8000-000000000002', key: 't2', severity: 'down', tier: 2, steps: [l0, l1] },
    { id: '00000000-0000-4000-8000-000000000003', key: 't3', severity: 'down', tier: 3, steps: [l0, l1] },
    {
      id: '00000000-0000-4000-8000-000000000004',
      key: 'problem',
      severity: 'problem',
      tier: null,
      steps: [l0, { ...l1, delayMin: 60, targets: ['backup'] }],
    },
  ],
  downReminder: 15,
  problemReminder: 60,
  hours: { startMin: 540, endMin: 1080, days: [1, 2, 3, 4, 5], holidays: [] },
  sites: [{ id: 's1', name: 'MuvMi', tier: 1, owner: 'Arm', backup: 'Ploy', am: 'Bua' }],
  admins: ['Tao'],
  openIncidents: [{ number: 142, key: 't1' }],
};
// Fri 25 Sep 2026 09:48 Bangkok.
const NOW = '2026-09-25T02:48:00Z';

afterEach(() => vi.clearAllMocks());

const openL1 = () => fireEvent.click(screen.getByRole('button', { name: 'Edit L1' }));
const dialog = (name: RegExp | string) => screen.getByRole('dialog', { name });

describe('Escalation editor — guardrails (Done-when 3, spec §14.7, §15.5)', () => {
  it('a step under +15 min is refused in the dialog with the board’s words', () => {
    render(<EscalationEditor data={data} now={NOW} />);
    openL1();
    const d = dialog(/Edit L1 · Tier 1 DOWN/);
    fireEvent.change(within(d).getByLabelText('Notify after'), { target: { value: '10' } });
    expect(within(d).getByText('At least +15 min — L0 covers the first 15 minutes')).toBeInTheDocument();
    fireEvent.click(within(d).getByRole('button', { name: 'Apply to L1' }));
    expect(screen.getByRole('dialog', { name: /Edit L1/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull();
  });

  it('a step with no channel can be applied, but Save stays blocked with the error listed', () => {
    render(<EscalationEditor data={data} now={NOW} />);
    openL1();
    const d = dialog(/Edit L1/);
    fireEvent.click(within(d).getByRole('checkbox', { name: 'Chat @mention' }));
    fireEvent.click(within(d).getByRole('checkbox', { name: 'Email' }));
    expect(
      within(d).getByText(/No channel ticked — this step notifies nobody\. You can apply it/),
    ).toBeInTheDocument();
    fireEvent.click(within(d).getByRole('button', { name: 'Apply to L1' }));
    // The row shows it; the save dialog lists it and refuses.
    expect(screen.getAllByText('No channel ticked — this step notifies nobody.').length).toBeGreaterThan(0);
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Unsaved changes' })).getByRole('button', { name: 'Save' }),
    );
    const save = dialog('Save escalation changes?');
    expect(within(save).getByText('Fix 1 problem before saving')).toBeInTheDocument();
    expect(
      within(save).getByText('Tier 1 DOWN · L1 (+15 min): No channel ticked — this step notifies nobody.'),
    ).toBeInTheDocument();
    expect(within(save).getByRole('button', { name: 'Save and log' })).toBeDisabled();
  });

  it('nobody picked: Apply refuses with "Pick at least one person."', () => {
    render(<EscalationEditor data={data} now={NOW} />);
    openL1();
    const d = dialog(/Edit L1/);
    fireEvent.click(within(d).getByRole('button', { name: 'Backup', pressed: true }));
    fireEvent.click(within(d).getByRole('button', { name: /Admin/, pressed: true }));
    fireEvent.click(within(d).getByRole('button', { name: 'Apply to L1' }));
    expect(within(d).getByText('Pick at least one person.')).toBeInTheDocument();
  });

  it('L0 is pinned: no pencil, no delete; the CEO is locked until L2 (S10)', () => {
    render(<EscalationEditor data={data} now={NOW} />);
    expect(screen.queryByRole('button', { name: 'Edit L0' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete L0' })).toBeNull();
    openL1();
    expect(within(dialog(/Edit L1/)).getByRole('button', { name: 'CEO' })).toBeDisabled();
  });

  it('deleting a DOWN L1 blocks the save; PROBLEM only warns and offers Add step', () => {
    render(<EscalationEditor data={data} now={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete L1' }));
    expect(
      screen.getByText('Tier 1 DOWN needs at least one step after L0 — otherwise nobody else is ever told.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'PROBLEM · all tiers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete L1' }));
    expect(screen.getByText(/PROBLEM has no step after L0/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add step' })).toBeInTheDocument();
  });
});

describe('Escalation editor — saving', () => {
  it('a note is required; then one save with the policies, Discard restores', async () => {
    actions.saveEscalation.mockResolvedValue({ ok: true });
    render(<EscalationEditor data={data} now={NOW} />);
    openL1();
    fireEvent.change(within(dialog(/Edit L1/)).getByLabelText('Notify after'), { target: { value: '20' } });
    fireEvent.click(within(dialog(/Edit L1/)).getByRole('button', { name: 'Apply to L1' }));
    const bar = screen.getByRole('region', { name: 'Unsaved changes' });
    expect(bar).toHaveTextContent('1 unsaved change');
    fireEvent.click(within(bar).getByRole('button', { name: 'Save' }));
    const save = dialog('Save escalation changes?');
    expect(
      within(save).getByText('Affects 1 site · 1 open incident (INC-0142) keeps its current timers'),
    ).toBeInTheDocument();
    fireEvent.click(within(save).getByRole('button', { name: 'Save and log' }));
    expect(
      within(save).getByText('Add a short note — it goes in the audit log with the change'),
    ).toBeInTheDocument();
    expect(actions.saveEscalation).not.toHaveBeenCalled();
    fireEvent.change(within(save).getByLabelText(/Change note/), { target: { value: 'later L1' } });
    await act(async () => fireEvent.click(within(save).getByRole('button', { name: 'Save and log' })));
    expect(actions.saveEscalation).toHaveBeenCalledWith(
      expect.objectContaining({ downReminderMin: 15, problemReminderMin: 60, note: 'later L1' }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it('a refusal shows in the dialog', async () => {
    actions.saveEscalation.mockResolvedValue({
      ok: false,
      message: 'Only an Admin can change escalation policies.',
    });
    render(<EscalationEditor data={data} now={NOW} />);
    fireEvent.change(screen.getByLabelText('DOWN reminder'), { target: { value: '10' } });
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Unsaved changes' })).getByRole('button', { name: 'Save' }),
    );
    const save = dialog('Save escalation changes?');
    fireEvent.change(within(save).getByLabelText(/Change note/), { target: { value: 'x' } });
    await act(async () => fireEvent.click(within(save).getByRole('button', { name: 'Save and log' })));
    expect(within(save).getByText('Only an Admin can change escalation policies.')).toBeInTheDocument();
  });

  it('Discard puts the saved policies back', () => {
    render(<EscalationEditor data={data} now={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete L1' }));
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Unsaved changes' })).getByRole('button', {
        name: 'Discard',
      }),
    );
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit L1' })).toBeInTheDocument();
  });

  it('Delete moves focus to the ladder heading (the trash button is gone)', async () => {
    render(<EscalationEditor data={data} now={NOW} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete L1' })));
    expect(screen.getByRole('heading', { name: 'Tier 1 DOWN steps' })).toHaveFocus();
  });

  it('opening the save dialog refreshes the page data, so the open incidents are current', () => {
    render(<EscalationEditor data={data} now={NOW} />);
    fireEvent.change(screen.getByLabelText('DOWN reminder'), { target: { value: '10' } });
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Unsaved changes' })).getByRole('button', { name: 'Save' }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('after a save: a "Saved" status and focus on the ladder heading', async () => {
    actions.saveEscalation.mockResolvedValue({ ok: true });
    render(<EscalationEditor data={data} now={NOW} />);
    fireEvent.change(screen.getByLabelText('DOWN reminder'), { target: { value: '10' } });
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Unsaved changes' })).getByRole('button', { name: 'Save' }),
    );
    const save = dialog('Save escalation changes?');
    expect(
      within(save).getByText('Affects 1 site · 1 open incident (INC-0142) keeps its current timers'),
    ).toBeInTheDocument();
    fireEvent.change(within(save).getByLabelText(/Change note/), { target: { value: 'shorter' } });
    await act(async () => fireEvent.click(within(save).getByRole('button', { name: 'Save and log' })));
    expect(screen.getByText(/New incidents use it straight away/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tier 1 DOWN steps' })).toHaveFocus();
  });

  it('a save of "010" leaves no unsaved bar once the page comes back with 10', async () => {
    actions.saveEscalation.mockResolvedValue({ ok: true });
    const { rerender } = render(<EscalationEditor data={data} now={NOW} />);
    fireEvent.change(screen.getByLabelText('DOWN reminder'), { target: { value: '010' } });
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Unsaved changes' })).getByRole('button', { name: 'Save' }),
    );
    const save = dialog('Save escalation changes?');
    fireEvent.change(within(save).getByLabelText(/Change note/), { target: { value: 'shorter' } });
    await act(async () => fireEvent.click(within(save).getByRole('button', { name: 'Save and log' })));
    // Before the refresh lands: no unsaved bar beside "Saved".
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull();
    rerender(<EscalationEditor data={{ ...data, downReminder: 10 }} now={NOW} />);
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull();
    expect(screen.getByText(/New incidents use it straight away/)).toBeInTheDocument();
  });

  it('the edit dialog: the picking hint goes once someone is picked', () => {
    render(<EscalationEditor data={data} now={NOW} />);
    openL1();
    const d = dialog(/L1/);
    expect(within(d).getByText('Tokens resolve per site. Tao is the only active Admin.')).toBeInTheDocument();
    expect(within(d).queryByText(/Pick who this step notifies/)).toBeNull();
  });

  it('the Admin token names the Admin, with the one-Admin warning', () => {
    render(<EscalationEditor data={data} now={NOW} />);
    expect(screen.getByText('Admin (Tao)')).toBeInTheDocument();
    expect(screen.getByText('Tao is the only active Admin')).toBeInTheDocument();
  });

  it('closing the edit dialog returns focus to its pencil', async () => {
    render(<EscalationEditor data={data} now={NOW} />);
    const pencil = screen.getByRole('button', { name: 'Edit L1' });
    pencil.focus();
    fireEvent.click(pencil);
    await act(async () => fireEvent.click(within(dialog(/Edit L1/)).getByRole('button', { name: 'Cancel' })));
    expect(pencil).toHaveFocus();
  });
});

describe('Escalation view (MEscalation, read-only)', () => {
  it('names the people for the picked site and has no edit controls', () => {
    render(<EscalationView data={data} now={NOW} admin={false} />);
    expect(screen.getByText('Only an Admin can change escalation policies.')).toBeInTheDocument();
    expect(screen.getByText('Arm + Alerts Space')).toBeInTheDocument();
    expect(screen.getByText('Ploy + Tao')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit|Delete|Save/ })).toBeNull();
  });

  it('an Admin on a phone is told where to edit', () => {
    render(<EscalationView data={data} now={NOW} admin />);
    expect(screen.getByText('View only on phones.')).toBeInTheDocument();
    expect(screen.getByText('Admins change policies on a larger screen.')).toBeInTheDocument();
  });
});
