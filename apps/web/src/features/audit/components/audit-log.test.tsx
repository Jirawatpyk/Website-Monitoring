import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditEntry, AuditPage } from '../queries';
import { AuditLogView, countLine } from './audit-log';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const entry: AuditEntry = {
  id: 'a',
  at: '2026-09-25T02:58:02Z',
  atLabel: '09:58:02',
  actor: 'Ploy',
  action: 'incident.ack',
  words: 'Acknowledged',
  category: 'Incidents',
  entity: 'INC-0141 · Fuji Links',
  before: 'Unacked',
  after: 'Acknowledged',
  struck: true,
  beforeJson: { state: 'unacked' },
  afterJson: { state: 'acknowledged' },
};

const page = (over: Partial<AuditPage> = {}): AuditPage => ({
  nowIso: '2026-09-25T03:07:00Z',
  filters: { cat: 'All', actor: 'everyone', range: 'Last 7 days' },
  entries: [entry],
  total: 1,
  unfiltered: 1,
  actors: [
    { value: 'everyone', label: 'Everyone' },
    { value: 'system', label: 'System' },
  ],
  ...over,
});

beforeEach(() => push.mockReset());

describe('countLine', () => {
  it('the default view', () => {
    expect(countLine(page({ total: 34, unfiltered: 34 }))).toBe('34 entries · Fri 18 Sep → Fri 25 Sep 10:07');
  });
  it('filtered, and over the page limit', () => {
    expect(
      countLine(
        page({ total: 1, unfiltered: 34, filters: { cat: 'Incidents', actor: 'everyone', range: 'Today' } }),
      ),
    ).toBe('1 entry · today · filtered from 34');
    expect(countLine(page({ total: 1234, unfiltered: 1234 }))).toBe(
      'Newest 500 of 1,234 entries · Fri 18 Sep → Fri 25 Sep 10:07 · Export has them all',
    );
  });
});

describe('AuditLogView', () => {
  it('shows the row as the board draws it', () => {
    render(<AuditLogView data={page()} />);
    const row = screen.getAllByRole('row')[1]!;
    for (const text of [
      '09:58:02',
      'Ploy',
      'Acknowledged',
      'incident.ack',
      'INC-0141 · Fuji Links',
      'Unacked',
    ]) {
      expect(within(row).getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute('href', '/audit/export');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('a filter goes to the URL; Export follows it and says how many rows', () => {
    render(
      <AuditLogView
        data={page({
          total: 12,
          unfiltered: 40,
          filters: { cat: 'Incidents', actor: 'system', range: 'Last 30 days' },
        })}
      />,
    );
    expect(screen.getByRole('link', { name: 'Export 12 rows' })).toHaveAttribute(
      'href',
      '/audit/export?cat=incidents&actor=system&when=30d',
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'When' }));
    fireEvent.click(screen.getByRole('option', { name: 'All time' }));
    expect(push).toHaveBeenCalledWith('/audit?cat=incidents&actor=system&when=all', { scroll: false });
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!);
    expect(push).toHaveBeenLastCalledWith('/audit', { scroll: false });
  });

  it('Export says what it downloaded', () => {
    render(<AuditLogView data={page({ total: 34, unfiltered: 34 })} />);
    fireEvent.click(screen.getByRole('link', { name: 'Export CSV' }));
    expect(screen.getByRole('status')).toHaveTextContent('audit-log.csv · 34 rows downloaded');
  });

  it('no match: the empty line and nothing to export', () => {
    render(
      <AuditLogView
        data={page({
          entries: [],
          total: 0,
          unfiltered: 34,
          filters: { cat: 'Access', actor: 'everyone', range: 'Last 7 days' },
        })}
      />,
    );
    expect(screen.getByText('No entries match these filters.')).toBeInTheDocument();
  });
});
