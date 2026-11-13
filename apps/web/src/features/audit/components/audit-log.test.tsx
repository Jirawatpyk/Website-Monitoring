import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditEntry, AuditPage } from '../queries';
import { AuditLogView, FILTER_DEBOUNCE_MS, countLine } from './audit-log';

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
  beforeJson: null,
  afterJson: null,
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

beforeEach(() => {
  push.mockReset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('countLine', () => {
  it('the default view', () => {
    expect(countLine(page({ total: 34, unfiltered: 34 }))).toBe('34 entries · Fri 18 Sep → Fri 25 Sep 10:07');
  });
  it('narrowed, over the page limit, and a longer range alone', () => {
    expect(
      countLine(
        page({ total: 1, unfiltered: 34, filters: { cat: 'Incidents', actor: 'everyone', range: 'Today' } }),
      ),
    ).toBe('1 entry · today · filtered from 34');
    expect(countLine(page({ total: 1234, unfiltered: 1234 }))).toBe(
      'Newest 500 of 1,234 entries · Fri 18 Sep → Fri 25 Sep 10:07 · Export has them all',
    );
    // A longer range narrows nothing inside it: no "filtered from 120" next to 120 (L4).
    expect(
      countLine(
        page({ total: 120, unfiltered: 120, filters: { cat: 'All', actor: 'everyone', range: 'All time' } }),
      ),
    ).toBe('120 entries · all time');
  });
  it('the one-entity filter from Escalation’s Change history', () => {
    expect(
      countLine(
        page({
          total: 3,
          unfiltered: 40,
          filters: { cat: 'All', actor: 'everyone', range: 'All time', entity: 'escalation' },
        }),
      ),
    ).toBe('3 entries · all time · Escalation policies only · filtered from 40');
  });
});

describe('AuditLogView', () => {
  it('shows the row as the board draws it; Export is a plain link', () => {
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

  it('a filter shows at once, loads after the pause; Export follows the loaded filters', () => {
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
    // The desktop When (the phone's comes first in the DOM; jsdom shows both).
    const when = () => screen.getAllByRole('combobox', { name: 'When' }).at(-1)!;
    fireEvent.click(when());
    fireEvent.click(screen.getByRole('option', { name: 'All time' }));
    expect(when()).toHaveTextContent('All time');
    expect(push).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(FILTER_DEBOUNCE_MS));
    expect(push).toHaveBeenCalledWith('/audit?cat=incidents&actor=system&when=all', { scroll: false });
  });

  it('quick changes load once, with the last value (M4)', () => {
    render(<AuditLogView data={page()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Incidents' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Monitor' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Config' }));
    act(() => vi.advanceTimersByTime(FILTER_DEBOUNCE_MS));
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/audit?cat=config', { scroll: false });
  });

  it('Clear filters loads at once, and focus lands on Category once the cleared page is in', () => {
    const filtered = page({
      total: 0,
      entries: [],
      unfiltered: 34,
      filters: { cat: 'Access', actor: 'everyone', range: 'Last 7 days' },
    });
    const { rerender } = render(<AuditLogView data={filtered} />);
    const clear = screen.getAllByRole('button', { name: 'Clear filters' });
    // The count line's, and the phone's empty card's (MAuditLog §33.9).
    expect(clear).toHaveLength(2);
    fireEvent.click(clear[0]!);
    expect(push).toHaveBeenLastCalledWith('/audit', { scroll: false });
    rerender(<AuditLogView data={page({ total: 34, unfiltered: 34 })} />);
    // jsdom matches no min-width query: the phone's Category select takes focus.
    expect(screen.getAllByRole('combobox', { name: 'Category' })[0]).toHaveFocus();
  });

  it('Export says what it downloaded', () => {
    render(<AuditLogView data={page({ total: 34, unfiltered: 34 })} />);
    fireEvent.click(screen.getByRole('link', { name: 'Export CSV' }));
    expect(screen.getByRole('status')).toHaveTextContent('audit-log.csv · 34 rows downloaded');
  });

  it('empty: "no match" when narrowed; a quiet week offers all time (L1)', () => {
    const { unmount } = render(
      <AuditLogView
        data={page({
          entries: [],
          total: 0,
          unfiltered: 34,
          filters: { cat: 'Access', actor: 'everyone', range: 'Last 7 days' },
        })}
      />,
    );
    expect(screen.getAllByText('No entries match these filters.').length).toBeGreaterThan(0);
    unmount();
    render(<AuditLogView data={page({ entries: [], total: 0, unfiltered: 0 })} />);
    expect(screen.getAllByText('Nothing logged in the last 7 days').length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Show all time' })[0]!);
    expect(push).toHaveBeenCalledWith('/audit?when=all', { scroll: false });
  });
});
