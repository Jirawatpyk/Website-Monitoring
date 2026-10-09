// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { ListIncident } from './model';

const m = vi.hoisted(() => ({ listIncidents: vi.fn() }));
vi.mock('./detail-queries', () => ({ listIncidents: m.listIncidents }));

const { filtersOf, incidentsListCsv } = await import('./downloads');

const NOW = new Date('2026-09-25T03:07:00Z');
const row: ListIncident = {
  id: 'i139',
  number: 139,
  siteId: 's-orca',
  siteName: 'ORCA Thailand',
  tier: 2,
  severity: 'down',
  trigger: 'hard_fail',
  state: 'resolved',
  escalationLevel: 0,
  startedAt: '2026-09-24T15:14:00Z',
  downStartedAt: null,
  detectedAt: '2026-09-24T15:14:30Z',
  ackedAt: null,
  ackedByName: null,
  recoveredAt: '2026-09-24T15:22:00Z',
  resolvedAt: '2026-09-25T03:08:00Z',
  autoResolved: false,
  isFlapping: false,
  isManual: false,
  ownerName: 'Tao',
  primaryOwnerId: null,
  backupOwnerId: null,
  rootCauseCategory: 'hosting',
  rootCause: '=Host rebooted, "quietly"',
  rootCauseFix: null,
};

describe('Incidents CSV (D-033)', () => {
  it('reads the list filters from the link, falling back on anything unknown', () => {
    expect(
      filtersOf(
        new URLSearchParams('view=done&severity=problem&period=7&site=0b9a8f43-1d0c-4c3e-9d0a-1f2e3d4c5b6a'),
      ),
    ).toEqual({
      view: 'done',
      severity: 'problem',
      period: 7,
      siteId: '0b9a8f43-1d0c-4c3e-9d0a-1f2e3d4c5b6a',
    });
    expect(filtersOf(new URLSearchParams('view=evil&severity=x&period=9&site=not-a-uuid'))).toEqual({
      view: 'needs_action',
      severity: 'all',
      period: 30,
      siteId: null,
    });
  });

  it('exports the rows the list shows, in words, safe for spreadsheets', async () => {
    m.listIncidents.mockResolvedValue({ incidents: [row], sites: [] });
    const res = await incidentsListCsv(new URLSearchParams('view=done'), NOW);
    expect(res.headers.get('content-disposition')).toContain('incidents-last-30-days.csv');
    const text = await res.text();
    expect(text.split('\r\n')[0]).toBe(
      'Incident,Site,Severity,Trigger,State,Started (UTC+7),Recovered (UTC+7),Resolved (UTC+7),Duration,Owner,Root cause,What happened',
    );
    expect(text).toContain('INC-0139,ORCA Thailand,Down,Hard fail,resolved,');
    expect(text).toContain(`Hosting / server,"'=Host rebooted, ""quietly"""`);
  });

  it('refuses without a session', async () => {
    m.listIncidents.mockResolvedValue(null);
    expect((await incidentsListCsv(new URLSearchParams(), NOW)).status).toBe(401);
  });
});
