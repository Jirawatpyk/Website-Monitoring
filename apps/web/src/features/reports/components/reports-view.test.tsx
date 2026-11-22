import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReportRow, ReportsPage } from '../page-data';
import { ReportsView } from './reports-view';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

// S20, boards Reports / MReports (spec §42): sample rows are made up for the test.
const row = (over: Partial<ReportRow> = {}): ReportRow => ({
  clientId: 'c1',
  client: 'Bangkok Airways',
  sites: 2,
  siteNames: ['BA China', 'BA Taiwan'],
  uptime: '99.97%',
  down: '26 min',
  incidents: '2',
  incidentNote: '1 outage, 1 degraded',
  am: 'Bua',
  needsRootCause: true,
  tier1: true,
  status: 'draft',
  ...over,
});

const page = (over: Partial<ReportsPage> = {}): ReportsPage => ({
  month: '2026-10',
  label: 'October 2026',
  running: false,
  closed: '2026-10',
  runningMonth: '2026-11',
  rows: [
    row(),
    row({
      clientId: 'c2',
      client: 'ENEOS',
      tier1: false,
      needsRootCause: false,
      status: 'not_drafted',
      incidents: '0',
      incidentNote: '',
      siteNames: ['ENEOS'],
      sites: 1,
    }),
  ],
  tiles: [
    { label: 'Uptime · Oct 2026', value: '99.98%', caption: '11 client sites · maintenance excluded' },
    { label: 'Downtime', value: '1 h 58 min', caption: 'Outages only, across all clients' },
    { label: 'Incidents', value: '10', caption: '8 outages · 2 degraded' },
  ],
  ...over,
});

const card = (name: RegExp) => screen.getByRole('button', { name });

describe('ReportsView', () => {
  it('a card opens the sheet with the figures, Open PDF and Send off with its reason; closing returns focus', async () => {
    render(<ReportsView data={page()} asOf="Sun 22 Nov 13:03" canOpen />);
    const ba = card(
      /^Bangkok Airways, Tier 1, uptime 99\.97%, down 26 min, 2 incidents, report Draft ready, needs root cause/,
    );
    fireEvent.click(ba);
    const sheet = screen.getByRole('dialog');
    expect(sheet).toHaveTextContent('October 2026 · Tier 1 · AM Bua');
    expect(sheet).toHaveTextContent('2 · 1 outage, 1 degraded');
    expect(sheet).toHaveTextContent('BA China, BA Taiwan');
    expect(within(sheet).getByRole('link', { name: /^Open PDF — Bangkok Airways/ })).toHaveAttribute(
      'href',
      '/api/reports/c1/2026-10',
    );
    expect(within(sheet).getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(sheet).toHaveTextContent('Sending from here comes later');
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(ba).toHaveFocus();
  });

  it('settled statuses; one site is "Site"; a running month says so', () => {
    render(
      <ReportsView
        data={page({
          month: '2026-11',
          running: true,
          label: 'November 2026 (running)',
          rows: [row({ status: 'running', siteNames: ['MuvMi'], sites: 1 })],
        })}
        asOf="Sun 22 Nov 13:03"
        canOpen
      />,
    );
    expect(screen.getByText('Preview draft · generated on demand')).toBeInTheDocument();
    fireEvent.click(card(/^Bangkok Airways/));
    const sheet = screen.getByRole('dialog');
    expect(sheet).toHaveTextContent('Month running');
    expect(sheet).toHaveTextContent('nothing is stored or sent until the 1 Dec draft');
    expect(within(sheet).getByText('Site')).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: /^Open preview draft/ })).toBeInTheDocument();
  });

  it('the rule note opens with More; the month switch pushes the running month', () => {
    render(<ReportsView data={page()} asOf="Sun 22 Nov 13:03" canOpen />);
    const more = screen.getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(screen.getByRole('button', { name: 'Less' })).toHaveAttribute('aria-expanded', 'true');
    // two switches: the header's from md, a full-width one below md
    expect(screen.getAllByRole('radio', { name: 'Nov 2026' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('radio', { name: 'Nov 2026' })[0]!);
    expect(push).toHaveBeenCalledWith('/reports?month=2026-11', { scroll: false });
    expect(screen.getAllByText('No draft yet').length).toBeGreaterThan(0);
  });

  it('a Viewer sees the figures, but Preview and Open PDF are off with the reason (PRD §3)', () => {
    render(<ReportsView data={page()} asOf="Sun 22 Nov 13:03" canOpen={false} />);
    expect(screen.queryByRole('link', { name: /opens in a new tab/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Preview' })[0]).toBeDisabled();
    fireEvent.click(card(/^Bangkok Airways/));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('button', { name: 'Open PDF' })).toBeDisabled();
    expect(sheet).toHaveTextContent('opening the PDF is for Admins, Responders and Stakeholders');
  });

  it('no rows: the empty state', () => {
    render(<ReportsView data={page({ rows: [] })} asOf="Sun 22 Nov 13:03" canOpen />);
    expect(screen.getByText('No client sites were watched this month')).toBeInTheDocument();
  });
});
