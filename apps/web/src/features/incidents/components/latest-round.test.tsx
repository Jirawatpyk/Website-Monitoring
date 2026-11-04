import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { IncidentDetail } from '../detail-queries';
import { clientUpdateCardOf } from '../model';
import { LatestRoundCard } from './incident-sections';

// Staging /verify S12b (4 Nov 2026), test fixtures only: SIN and TYO stopped at 18:44 with the crons
// off, BKK reported at 18:51.
const cell = (at: string) => ({ text: '200 · 60 ms', glyph: 'pass' as const, at: `2026-11-04T${at}+07:00` });
const detail = {
  trigger: 'hard_fail',
  locations: [
    { location: 'BKK', first: null, recheck: null, latest: cell('18:51:01') },
    { location: 'SIN', first: null, recheck: null, latest: cell('18:44:46') },
    { location: 'TYO', first: null, recheck: null, latest: cell('18:44:02') },
  ],
} as unknown as IncidentDetail;

describe('LatestRoundCard — a silent location has no result in the round', () => {
  it('SIN and TYO read No data and the verdict counts BKK alone', () => {
    render(<LatestRoundCard detail={detail} />);
    expect(screen.getByText('1/1 pass → OK')).toBeInTheDocument();
    expect(screen.getAllByText('No data').length).toBeGreaterThanOrEqual(2);
  });
});

describe('clientUpdateCardOf — sent by hand (§30.7)', () => {
  it('"Thee notified 02:36 (by hand)"', () => {
    const card = clientUpdateCardOf({
      required: true,
      dueAt: '2026-09-25T19:46:00Z',
      updatedAt: null,
      by: null,
      notNeeded: false,
      note: null,
      tier: 1,
      notified: { am: 'Thee', at: '2026-09-25T19:36:00Z', byHand: true },
      am: 'Thee',
      client: 'realme',
      drafts: { th: 'th', en: 'en' },
      lang: 'en',
      canMark: true,
    })!;
    expect(card.byHand).toBe(true);
    expect(card.banner).toBe('Client update due 02:46 · Thee notified 02:36 (by hand) · not marked yet');
  });
});
