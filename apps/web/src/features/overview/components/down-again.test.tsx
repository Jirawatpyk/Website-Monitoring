import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { HandCheckRow } from '../hand-check';
import { HandCheckCard, type HandCheckActions } from './hand-check-card';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

// D-055 item 7 (test fixtures only): MuvMi recovered at 00:10 as INC-0142 and is down again at 02:40.
const row = (downAgain: 'relapse' | 'raise'): HandCheckRow => ({
  siteId: 's-muvmi',
  name: 'MuvMi',
  url: null,
  ownerName: 'Arm',
  status: 'ok',
  line: { kind: 'open', text: 'Open INC-0142 · Needs root cause', incidentId: 'i142', tone: 'warning' },
  canCheck: true,
  canOpen: false,
  readOnly: null,
  statusNote: 'as of 02:17',
  paused: null,
  openIncident: {
    id: 'i142',
    ref: 'INC-0142',
    downAgain,
    info:
      downAgain === 'relapse'
        ? [
            'Posts DOWN AGAIN in INC-0142’s thread now, @mentioning Arm — who acknowledged it.',
            'Levels already reached stay: it goes back to Acknowledged and doesn’t start over at L0.',
          ]
        : ['Raises INC-0142 to DOWN and posts the DOWN alert now, @mentioning Ploy (on call).'],
  },
});
/** The row after the press, as the refresh brings it: down by hand, its buttons gone. */
const reported: HandCheckRow = {
  ...row('relapse'),
  line: { kind: 'incident', text: 'INC-0142 reported down · Tao 02:40', incidentId: 'i142' },
  canCheck: false,
  statusNote: 'by hand 02:40',
  openIncident: null,
};
const card = (r: HandCheckRow) => ({
  rows: [r],
  count: '0 of 1 checked since 02:17',
  shortCount: '0 of 1 checked',
  footer: '',
  otherTiers: null,
});
const view = (r: HandCheckRow, actions: Partial<HandCheckActions> = {}) => {
  const all = { record: vi.fn(), open: vi.fn(), downAgain: vi.fn(), ...actions };
  const ui = (x: HandCheckRow) => (
    <HandCheckCard card={card(x)} asOf="02:17" viewerName="Tao" actions={all} phone />
  );
  const out = render(ui(r));
  return { ...out, rerenderWith: (x: HandCheckRow) => out.rerender(ui(x)) };
};

describe('Down again by hand (D-055 item 7)', () => {
  it('a recovered incident: the confirm says DOWN AGAIN and sends the note to downAgain', async () => {
    const downAgain = vi.fn().mockResolvedValue({ ok: true, incidentId: 'i142' });
    const open = vi.fn();
    view(row('relapse'), { downAgain, open });
    fireEvent.click(screen.getByRole('button', { name: 'Down again · MuvMi' }));
    const dialog = await screen.findByRole('dialog', { name: 'Report MuvMi down again?' });
    expect(dialog).toHaveTextContent('Posts DOWN AGAIN in INC-0142’s thread now, @mentioning Arm');
    expect(dialog).toHaveTextContent('Levels already reached stay');
    fireEvent.change(screen.getByLabelText(/What did you see/), { target: { value: '502 again' } });
    fireEvent.click(screen.getByRole('button', { name: 'Report down' }));
    await waitFor(() => expect(downAgain).toHaveBeenCalledWith({ incidentId: 'i142', note: '502 again' }));
    expect(open).not.toHaveBeenCalled();
  });

  it('a PROBLEM was never down: Report down, and the confirm says it is raised', async () => {
    view(row('raise'));
    fireEvent.click(screen.getByRole('button', { name: 'Report down · MuvMi' }));
    const dialog = await screen.findByRole('dialog', { name: 'Report MuvMi down?' });
    expect(dialog).toHaveTextContent(
      'Raises INC-0142 to DOWN and posts the DOWN alert now, @mentioning Ploy',
    );
  });

  it('after the press the button is gone: focus moves to the row’s incident link', async () => {
    const downAgain = vi.fn().mockResolvedValue({ ok: true, incidentId: 'i142' });
    const { rerenderWith } = view(row('relapse'), { downAgain });
    fireEvent.click(screen.getByRole('button', { name: 'Down again · MuvMi' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Report down' }));
    await waitFor(() => expect(downAgain).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // the router refresh brings the row back without its buttons
    act(() => rerenderWith(reported));
    await waitFor(() => expect(screen.getByRole('link', { name: /INC-0142 reported down/ })).toHaveFocus());
  });

  it('a refusal stays in the dialog under “Not reported”', async () => {
    view(row('relapse'), {
      downAgain: vi
        .fn()
        .mockResolvedValue({ ok: false, message: 'This incident is down already, or closed.' }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Down again · MuvMi' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Report down' }));
    expect(await screen.findByText('Not reported')).toBeInTheDocument();
    // a network error can be retried
    expect(screen.getByRole('button', { name: 'Report down' })).toBeEnabled();
  });

  it('the incident changed before the press (§31.6): refused, and Report down is disabled', async () => {
    view(row('relapse'), {
      downAgain: vi
        .fn()
        .mockResolvedValue({ ok: false, message: 'This incident is down already, or closed.', stale: true }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Down again · MuvMi' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Report down' }));
    expect(
      await screen.findByText(
        'This incident is down already, or closed. Close this and look at the row again.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Report down' })).toBeDisabled();
  });

  it('the row links its open incident on the line, beside Loads OK and Down again (§31.1)', () => {
    view(row('relapse'));
    expect(screen.getByRole('link', { name: /Open INC-0142 · Needs root cause/ })).toHaveAttribute(
      'href',
      '/incidents/i142',
    );
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Loads OK', 'Down again…']);
  });

  it('without the action there is no Down again button', () => {
    render(
      <HandCheckCard
        card={card(row('relapse'))}
        asOf="02:17"
        viewerName="Tao"
        actions={{ record: vi.fn(), open: vi.fn() }}
        phone
      />,
    );
    expect(screen.queryByRole('button', { name: 'Down again · MuvMi' })).toBeNull();
  });
});
