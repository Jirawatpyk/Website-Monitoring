import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandCheckCard as Card } from '../hand-check';
import { HandCheckCard } from './hand-check-card';

const m = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), record: vi.fn(), open: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: m.refresh, push: m.push }) }));

// MainFault sample (spec §30.2, test fixtures only).
const card = (over: Partial<Card> = {}): Card => ({
  rows: [
    {
      siteId: 's-realme',
      name: 'realme.link',
      url: 'https://realme.example.test/',
      ownerName: 'Nok',
      status: 'ok',
      line: { kind: 'none', text: 'Not checked yet' },
      canCheck: true,
      canOpen: true,
      readOnly: null,
    },
    {
      siteId: 's-muvmi',
      name: 'MuvMi',
      url: null,
      ownerName: 'Arm',
      status: 'ok',
      line: { kind: 'incident', text: 'INC-0143 opened · Tao 02:31', incidentId: 'i143' },
      canCheck: false,
      canOpen: false,
      readOnly: null,
    },
    {
      siteId: 's-eneos',
      name: 'ENEOS',
      url: null,
      ownerName: 'Arm',
      status: 'ok',
      line: { kind: 'ok', text: 'Checked OK · Tao 02:31' },
      canCheck: false,
      canOpen: false,
      readOnly: 'Only Arm, the person on call or an Admin',
    },
  ],
  count: '2 of 3 checked since 02:17',
  shortCount: '2 of 3 checked',
  footer: 'Next check due by 03:01 — every 30 min while monitoring is degraded.',
  otherTiers: 'Tier 2–3 (6 sites): not needed — the hand check covers Tier 1 only.',
  ...over,
});
const view = (phone = false) =>
  render(
    <HandCheckCard
      card={card()}
      asOf="02:17"
      viewerName="Tao"
      actions={{ record: m.record, open: m.open }}
      phone={phone}
    />,
  );

beforeEach(() => vi.clearAllMocks());

describe('HandCheckCard (S12b, spec §30.2–4)', () => {
  it('desktop: rows, count, footer lines, the opened incident link, who may press', () => {
    view();
    expect(screen.getByText('2 of 3 checked since 02:17')).toBeInTheDocument();
    expect(screen.getByText(/^Next check due by 03:01/)).toBeInTheDocument();
    expect(screen.getByText(/^Tier 2–3 \(6 sites\)/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /INC-0143 opened · Tao 02:31/ })).toHaveAttribute(
      'href',
      '/incidents/i143',
    );
    expect(screen.getByText('Only Arm, the person on call or an Admin')).toBeInTheDocument();
    expect(screen.getAllByText('as of 02:17')).toHaveLength(3);
  });

  it('Loads OK records at once — no confirm', async () => {
    m.record.mockResolvedValue({ ok: true });
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Loads OK · realme.link' }));
    await waitFor(() => expect(m.record).toHaveBeenCalledWith('s-realme'));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(m.refresh).toHaveBeenCalled());
  });

  it('a refused Loads OK says why', async () => {
    m.record.mockResolvedValue({ ok: false, message: 'The status engine is running again.' });
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Loads OK · realme.link' }));
    expect(await screen.findByText('The status engine is running again.')).toBeInTheDocument();
  });

  it('Down: the confirm with the counter; Open incident goes to the new incident', async () => {
    m.open.mockResolvedValue({ ok: true, incidentId: 'i144' });
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Down — open incident · realme.link' }));
    const dialog = await screen.findByRole('dialog', { name: 'Open an incident for realme.link?' });
    expect(dialog).toHaveTextContent('realme.link · Tier 1 · owner Nok · statuses are from 02:17');
    expect(dialog).toHaveTextContent(
      'Posts the DOWN alert to the Alerts Space now and starts the client-update clock.',
    );
    expect(dialog).toHaveTextContent('Logged in the audit log as Tao.');
    fireEvent.change(screen.getByLabelText(/What did you see/), {
      target: { value: 'Home page shows a 502 error' },
    });
    expect(dialog).toHaveTextContent('27 / 500 · optional — shown on the incident timeline');
    fireEvent.click(screen.getByRole('button', { name: 'Open incident' }));
    await waitFor(() =>
      expect(m.open).toHaveBeenCalledWith({ siteId: 's-realme', note: 'Home page shows a 502 error' }),
    );
    await waitFor(() => expect(m.push).toHaveBeenCalledWith('/incidents/i144'));
  });

  it('a refused open stays in the dialog', async () => {
    m.open.mockResolvedValue({ ok: false, message: 'This site already has an open incident.' });
    view(true);
    fireEvent.click(screen.getByRole('button', { name: 'Down — open incident · realme.link' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open incident' }));
    expect(await screen.findByText('This site already has an open incident.')).toBeInTheDocument();
    expect(m.push).not.toHaveBeenCalled();
  });

  it('phone: row cards, the short count, "Down…" on the button', () => {
    view(true);
    expect(screen.getByText('2 of 3 checked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Down — open incident · realme.link' })).toHaveTextContent(
      'Down…',
    );
    expect(screen.getByText('Owner Nok · OK as of 02:17')).toBeInTheDocument();
    expect(screen.queryByText(/^Next check due/)).toBeNull();
  });
});
