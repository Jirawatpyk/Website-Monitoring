import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fake-db';
import { maintenanceSpansBySite } from './detail-queries';

const t = (hhmm: string) => `2026-10-06T${hhmm}:00Z`;
const window = {
  site_id: 's1',
  starts_at: t('10:00'),
  ends_at: t('12:00'),
  approved_at: t('08:00'),
  ended_at: null,
  cancelled_at: null,
};
const inc = (events: { type: string; at: string; payload?: Record<string, unknown> }[]) => ({
  site_id: 's1',
  started_at: t('09:00'),
  severity: 'down',
  resolved_at: null,
  incident_events: events.map((e) => ({ payload: {}, ...e })),
});

describe('maintenanceSpansBySite (spec §5, D-036)', () => {
  it('a window that started after the incident recovered is removed, even after a later relapse clears recovered_at', async () => {
    const { db, calls } = fakeDb({
      'maintenance_windows.select': { data: [window] },
      'incidents.select': {
        data: [
          inc([
            { type: 'detected', at: t('09:01') },
            { type: 'recovered', at: t('09:30') },
            { type: 'relapsed', at: t('10:31'), payload: { startedAt: t('10:30'), severity: 'down' } },
          ]),
        ],
      },
    });
    const spans = await maintenanceSpansBySite(db, ['s1'], new Date(t('00:00')));
    expect(spans.get('s1')).toEqual([{ start: new Date(t('10:00')), end: new Date(t('12:00')) }]);
    // Only windows whose start the engine checked count (as windows.ts reads them).
    expect(calls.find((c) => c.table === 'maintenance_windows')?.filters).toContainEqual([
      'eq',
      'start_logged',
      true,
    ]);
  });

  it('a window that started while the incident was still failing removes nothing (§14.5)', async () => {
    const { db } = fakeDb({
      'maintenance_windows.select': { data: [window] },
      'incidents.select': {
        data: [
          inc([
            { type: 'detected', at: t('09:01') },
            { type: 'recovered', at: t('11:00') },
          ]),
        ],
      },
    });
    const spans = await maintenanceSpansBySite(db, ['s1'], new Date(t('00:00')));
    expect(spans.get('s1')).toEqual([]);
  });
});
