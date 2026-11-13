import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AuditEntry } from '../queries';
import { AuditCards, CARD_PAGE } from './audit-cards';

const entry = (i: number, over: Partial<AuditEntry> = {}): AuditEntry => ({
  id: `e${i}`,
  at: '2026-09-25T02:20:14Z',
  atLabel: '09:20:14',
  actor: 'Arm',
  action: 'maintenance.request',
  words: 'Asked for maintenance',
  category: 'Maintenance & mute',
  entity: 'Bangkok Airways – China',
  before: '—',
  after: 'Sat 26 Sep 22:00 · “Move to a new hosting provider”',
  struck: false,
  beforeJson: null,
  afterJson: null,
  ...over,
});

const cards = () => screen.getAllByRole('button', { name: /Open the full entry$/ });

describe('AuditCards (MAuditLog §33.6–9)', () => {
  it('a quiet range: the same words as desktop, and Show all time', () => {
    const onShowAll = vi.fn();
    render(
      <AuditCards
        entries={[]}
        narrowed={false}
        range="Last 30 days"
        resetKey=""
        onClear={() => {}}
        onShowAll={onShowAll}
      />,
    );
    expect(screen.getByText('Nothing logged in the last 30 days')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all time' }));
    expect(onShowAll).toHaveBeenCalled();
  });

  it('25 at a time; Show more adds the next and focuses the first new card', () => {
    render(
      <AuditCards
        range="Last 7 days"
        onShowAll={() => {}}
        entries={Array.from({ length: 34 }, (_, i) => entry(i))}
        narrowed={false}
        resetKey=""
        onClear={() => {}}
      />,
    );
    expect(cards()).toHaveLength(CARD_PAGE);
    expect(screen.getByText('25 of 34 shown')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show 9 more' }));
    expect(cards()).toHaveLength(34);
    expect(cards()[25]).toHaveFocus();
    expect(screen.queryByRole('button', { name: /^Show \d+ more$/ })).toBeNull();
  });

  it('new filters put it back to 25', () => {
    const list = Array.from({ length: 30 }, (_, i) => entry(i));
    const { rerender } = render(
      <AuditCards
        range="Last 7 days"
        onShowAll={() => {}}
        entries={list}
        narrowed={false}
        resetKey="a"
        onClear={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show 5 more' }));
    rerender(
      <AuditCards
        range="Last 7 days"
        onShowAll={() => {}}
        entries={list}
        narrowed
        resetKey="b"
        onClear={() => {}}
      />,
    );
    expect(cards()).toHaveLength(CARD_PAGE);
  });

  it('a card shows no struck Before for a new item; the sheet shows every field in full', () => {
    render(
      <AuditCards
        range="Last 7 days"
        onShowAll={() => {}}
        entries={[entry(0)]}
        narrowed={false}
        resetKey=""
        onClear={() => {}}
      />,
    );
    expect(screen.queryByText('—')).toBeNull();
    fireEvent.click(cards()[0]!);
    const sheet = screen.getByRole('dialog');
    expect(sheet).toHaveTextContent('Fri 25 Sep 2026 09:20:14 (UTC+7)');
    expect(within(sheet).getByText('maintenance.request · Maintenance & mute')).toBeInTheDocument();
    expect(sheet).toHaveTextContent('Can’t be edited or deleted.');
  });

  it('System is the monitor icon, not an avatar; empty when narrowed offers Clear filters', () => {
    const onClear = vi.fn();
    const { unmount } = render(
      <AuditCards
        range="Last 7 days"
        onShowAll={() => {}}
        entries={[entry(0, { actor: 'System' })]}
        narrowed={false}
        resetKey=""
        onClear={onClear}
      />,
    );
    expect(screen.queryByText('SY')).toBeNull();
    unmount();
    render(
      <AuditCards
        range="Last 7 days"
        onShowAll={() => {}}
        entries={[]}
        narrowed
        resetKey=""
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClear).toHaveBeenCalled();
  });
});
