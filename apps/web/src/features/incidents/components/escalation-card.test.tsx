import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EscalationCardView } from '../escalation-card';
import { ClientUpdateReminder, EscalateNow, EscalationCard } from './escalation-card';

const m = vi.hoisted(() => ({ refresh: vi.fn(), escalateNow: vi.fn(), sendClientUpdateReminder: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock('../hand-actions', () => ({
  escalateNow: m.escalateNow,
  sendClientUpdateReminder: m.sendClientUpdateReminder,
}));

// Spec §30.6–7 sample (test fixtures only): INC-0143 realme.link, the engine down since 02:17.
const card = (over: Partial<EscalationCardView> = {}): EscalationCardView => ({
  title: 'Escalation · Tier 1 DOWN',
  rows: [
    {
      label: 'L0',
      when: '0 min · 02:31',
      who: 'Ploy (on call) + Alerts Space',
      status: 'Sent 02:31',
      tone: 'sent',
    },
    {
      label: 'L1',
      when: '+15 min · 02:46',
      who: 'Arm (backup) + Tao',
      status: 'Waits — engine down',
      tone: 'next',
    },
  ],
  stopped:
    'Nothing escalates on its own — the status engine is down since 02:17. Send the next level by hand if nobody acknowledges.',
  back: null,
  button: {
    level: 1,
    label: 'Escalate now · L1 (Arm, backup · Tao)',
    title: 'Send L1 now?',
    people: [
      { name: 'Arm', role: 'backup' },
      { name: 'Tao', role: 'Admin' },
    ],
    cta: 'Send L1 now',
  },
  footer: 'Acknowledge stops escalation. It does not stop the client update.',
  ...over,
});
const props = { incidentId: 'i143', incidentLabel: 'INC-0143', siteName: 'realme.link' };

beforeEach(() => vi.clearAllMocks());

describe('EscalationCard (S12b, spec §30.6–8)', () => {
  it('desktop: the ladder, the danger note and the button in the card', () => {
    render(<EscalationCard card={card()} {...props} phone={false} />);
    expect(screen.getByText('Escalation · Tier 1 DOWN')).toBeInTheDocument();
    expect(screen.getByText('Waits — engine down')).toBeInTheDocument();
    expect(screen.getByText(/^Nothing escalates on its own/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Escalate now · L1 \(Arm, backup · Tao\)/ }),
    ).toBeInTheDocument();
  });

  it('phone: the ladder card says it is paused, the button lives in its own card', () => {
    render(<EscalationCard card={card()} {...props} phone />);
    expect(screen.getByText('Paused — engine down')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Escalate now/ })).toBeNull();
  });

  it('confirm names who gets it; Send sends the level shown, then refreshes', async () => {
    m.escalateNow.mockResolvedValue({ ok: true, level: 1, notified: 2 });
    render(<EscalateNow card={card()} {...props} phone={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Escalate now · L1/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Send L1 now?' });
    expect(dialog).toHaveTextContent('Arm · backup — Chat @mention + email');
    expect(dialog).toHaveTextContent('Sent at once · logged');
    fireEvent.click(screen.getByRole('button', { name: 'Send L1 now' }));
    await waitFor(() => expect(m.escalateNow).toHaveBeenCalledWith({ incidentId: 'i143', level: 1 }));
    await waitFor(() => expect(m.refresh).toHaveBeenCalled());
  });

  it('a refusal stays in the dialog, in words', async () => {
    m.escalateNow.mockResolvedValue({ ok: false, message: 'It was acknowledged — escalation has stopped.' });
    render(<EscalateNow card={card()} {...props} phone />);
    fireEvent.click(screen.getByRole('button', { name: /Escalate now · L1/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send L1' }));
    expect(await screen.findByText('It was acknowledged — escalation has stopped.')).toBeInTheDocument();
  });

  it('engine back: the running-again line, no button', () => {
    render(
      <EscalateNow
        card={card({
          stopped: null,
          button: null,
          back: 'Automatic escalation is running again — levels already sent won’t repeat.',
        })}
        {...props}
        phone
      />,
    );
    expect(screen.getByText(/Automatic escalation is running again/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('the engine running and nothing sent by hand: nothing', () => {
    const { container } = render(
      <EscalateNow card={card({ stopped: null, button: null })} {...props} phone />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ClientUpdateReminder (§30.7, D-055 item 3)', () => {
  const reminder = { to: 'Thee', role: 'Site AM', dueAt: '02:46', preFire: true };

  it('before the track fired: Not notified yet, the box and its confirm', async () => {
    m.sendClientUpdateReminder.mockResolvedValue({ ok: true });
    render(<ClientUpdateReminder reminder={reminder} {...props} phone={false} />);
    expect(screen.getByText('Due 02:46')).toBeInTheDocument();
    expect(screen.getByText(/Account manager · Not notified yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send client-update reminder now' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send the client-update reminder now?' });
    expect(dialog).toHaveTextContent('Thee · Site AM — Chat @mention with the draft + email');
    fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));
    await waitFor(() => expect(m.sendClientUpdateReminder).toHaveBeenCalledWith('i143'));
    await waitFor(() => expect(m.refresh).toHaveBeenCalled());
  });

  it('a refusal is shown; the box alone when the card is already there', async () => {
    m.sendClientUpdateReminder.mockResolvedValue({
      ok: false,
      message: 'The client-update reminder went already.',
    });
    render(<ClientUpdateReminder reminder={{ ...reminder, preFire: false }} {...props} phone />);
    expect(screen.queryByText('Due 02:46')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Send client-update reminder now' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send reminder' }));
    expect(await screen.findByText('The client-update reminder went already.')).toBeInTheDocument();
  });
});
