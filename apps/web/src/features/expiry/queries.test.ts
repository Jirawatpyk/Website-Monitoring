// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { DbClient } from '@dxt/db';
import { fakeDb } from '../../../test/fake-db';
import { loadExpiry, loadExpirySummary } from './queries';

const NOW = new Date('2026-09-25T03:00:00Z');

function db(
  settings = { response_start: '08:00:00', response_end: '17:00:00', response_days: [1, 2, 3, 4, 5, 6] },
) {
  return fakeDb({
    'sites.select': { data: [{ id: 'cando', name: 'Cando Asia', created_at: '2026-01-01T00:00:00Z' }] },
    'site_expiry.select': {
      data: [
        {
          site_id: 'cando',
          ssl_expires_at: '2026-11-19T05:00:00Z',
          ssl_valid_from: '2026-08-21T05:00:00Z',
          ssl_read_at: '2026-09-24T23:00:00Z',
          ssl_checked_at: '2026-09-24T23:00:00Z',
          ssl_error: null,
          domain_expires_at: '2026-11-05T05:00:00Z',
          domain_read_at: '2026-09-24T23:00:00Z',
          domain_checked_at: '2026-09-24T23:00:00Z',
          domain_error: null,
        },
      ],
    },
    'organisation_settings.select': { data: settings },
    'company_holidays.select': { data: [] },
  }).db as unknown as DbClient;
}

describe('loadExpiry', () => {
  it("How it alerts names the organisation's own response hours, not the seeded ones", async () => {
    const v = await loadExpiry(db(), NOW);
    expect(v.hours).toBe('Mon–Sat 08:00–17:00');
    expect(v.rows[0]).toMatchObject({ siteId: 'cando', status: 'soon' });
  });

  it('the Sites row reads the counts only', async () => {
    expect(await loadExpirySummary(db(), NOW)).toEqual({ due: 1, failed: 0, unchecked: 0 });
  });
});
