import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { HandCheckRow } from '../hand-check';
import { HandCheckCard } from './hand-check-card';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

// D-055 item 7 (test fixtures only): MuvMi recovered at 00:10 as INC-0142 and is down again at 02:40.
const row = (downAgain: 'relapse' | 'raise'): HandCheckRow => ({
  siteId: 's-muvmi',
  name: 'MuvMi',
  url: null,
  ownerName: 'Arm',
  status: 'ok',
  line: { kind: 'none', text: 'Not checked yet' },
  canCheck: true,
  canOpen: false,
  readOnly: null,
  statusNote: 'as of 02:17',
  paused: null,
  openIncident: { id: 'i142', label: 'Open INC-0142', downAgain },
});
const view = (r: HandCheckRow, downAgain = vi.fn(), open = vi.fn()) =>
  render(
    <HandCheckCard
      card={{
        rows: [r],
        count: '0 of 1 checked since 02:17',
        shortCount: '0 of 1 checked',
        footer: '',
        otherTiers: null,
      }}
      asOf="02:17"
      viewerName="Tao"
      actions={{ record: vi.fn(), open, downAgain }}
    />,
  );

describe('Down again by hand (D-055 item 7)', () => {
  it('a recovered incident: the confirm says DOWN AGAIN and sends the note to downAgain', async () => {
    const downAgain = vi.fn().mockResolvedValue({ ok: true, incidentId: 'i142' });
    const open = vi.fn();
    view(row('relapse'), downAgain, open);
    fireEvent.click(screen.getAllByRole('button', { name: 'Down again · MuvMi' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Report MuvMi down again?' });
    expect(dialog).toHaveTextContent("Posts DOWN AGAIN in INC-0142's thread now.");
    fireEvent.change(screen.getByLabelText(/What did you see/), { target: { value: '502 again' } });
    fireEvent.click(screen.getByRole('button', { name: 'Report down' }));
    await waitFor(() => expect(downAgain).toHaveBeenCalledWith({ incidentId: 'i142', note: '502 again' }));
    expect(open).not.toHaveBeenCalled();
  });

  it('a PROBLEM: the confirm says it is raised to DOWN', async () => {
    view(row('raise'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Down again · MuvMi' })[0]!);
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'Raises INC-0142 to DOWN and posts the alert now.',
    );
  });
});
