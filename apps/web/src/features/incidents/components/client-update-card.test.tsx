import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clientUpdateCardOf } from '../model';
import { ClientUpdateCard } from './client-update-card';

const m = vi.hoisted(() => ({ refresh: vi.fn(), markClientUpdate: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock('../actions', () => ({ markClientUpdate: m.markClientUpdate }));

// INC-0142 MuvMi (Incident board) — test fixtures only.
const card = (over: Partial<Parameters<typeof clientUpdateCardOf>[0]> = {}) =>
  clientUpdateCardOf({
    required: true,
    dueAt: '2026-09-25T03:03:12Z',
    updatedAt: null,
    by: null,
    notNeeded: false,
    note: null,
    tier: 1,
    am: 'Bua',
    client: 'MuvMi',
    drafts: { th: 'เรียนทีม MuvMi', en: 'Hi MuvMi team,' },
    lang: 'th',
    canMark: true,
    ...over,
  })!;
const view = (c = card(), phone = false, acked = false) =>
  render(
    <ClientUpdateCard
      card={c}
      incidentId="i142"
      incidentLabel="INC-0142"
      siteName="MuvMi"
      tier={1}
      acked={acked}
      phone={phone}
    />,
  );

describe('ClientUpdateCard (Incident / MIncident boards, S11)', () => {
  beforeEach(() => {
    m.refresh.mockReset();
    m.markClientUpdate.mockReset().mockResolvedValue({ ok: true });
  });

  it('shows the due time, the AM and the draft in the client’s language; TH / EN switch', () => {
    view();
    expect(screen.getByText('Due 10:03')).toBeInTheDocument();
    expect(screen.getByText('Notified 10:03')).toBeInTheDocument();
    expect(screen.getByText('Bua')).toBeInTheDocument();
    expect(screen.getByText('เรียนทีม MuvMi')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'EN' }));
    expect(screen.getByText('Hi MuvMi team,')).toBeInTheDocument();
  });

  it('Mark client updated opens the note dialog; the note is optional (D-052 item 1)', async () => {
    view(card(), false, true);
    const mark = screen.getByRole('button', { name: 'Mark client updated' });
    fireEvent.click(mark);
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: 'Called MuvMi ops, ETA shared' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark updated' }));
    await waitFor(() =>
      expect(m.markClientUpdate).toHaveBeenCalledWith({
        incidentId: 'i142',
        notNeeded: false,
        note: 'Called MuvMi ops, ETA shared',
      }),
    );
    expect(m.refresh).toHaveBeenCalled();
  });

  it('Not needed waits for a reason, then saves it', async () => {
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Not needed…' }));
    const save = screen.getByRole('button', { name: 'Mark not needed' });
    expect(save).toBeDisabled();
    expect(screen.getByText('A reason is required before you can save.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Client told us first' } });
    fireEvent.click(save);
    await waitFor(() =>
      expect(m.markClientUpdate).toHaveBeenCalledWith({
        incidentId: 'i142',
        notNeeded: true,
        note: 'Client told us first',
      }),
    );
  });

  it('a refusal stays in the dialog', async () => {
    m.markClientUpdate.mockResolvedValue({ ok: false, message: 'Only an Admin… can mark this.' });
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Mark client updated' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark updated' }));
    expect(await screen.findByText('Only an Admin… can mark this.')).toBeInTheDocument();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it('someone who may not mark it sees no buttons, and who does (no dead controls)', () => {
    view(card({ canMark: false }));
    expect(screen.queryByRole('button', { name: 'Mark client updated' })).toBeNull();
    expect(screen.getByText(/Bua, the site’s owner or an Admin marks it/)).toBeInTheDocument();
  });

  it('marked: the badge and the note; on the phone the success line', () => {
    view(card({ updatedAt: '2026-09-25T03:12:05Z', by: 'Bua', note: 'Called MuvMi ops, ETA shared' }), true);
    expect(screen.getByText('Updated')).toBeInTheDocument();
    expect(screen.getByText('Marked by Bua 10:12')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark client updated' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy draft' })).toBeInTheDocument();
  });
});
