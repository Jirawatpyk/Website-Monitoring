import { describe, expect, it } from 'vitest';
import {
  bangkokInstant,
  busyOf,
  doneOf,
  guardTitle,
  muteRule,
  planOf,
  reasonHint,
  startDays,
  submitLabel,
  whenText,
  type PausableSite,
} from './model';

// Fri 25 Sep 2026 10:07 (UTC+7) — the boards' "now" (spec §1).
const NOW = new Date('2026-09-25T03:07:00Z');
const inc = (state: 'unacked' | 'acknowledged', over = {}) => ({
  id: 'i142',
  number: 142,
  state,
  level: 1,
  detectedAt: '2026-09-25T02:48:41Z',
  ackedBy: state === 'acknowledged' ? 'Ploy' : null,
  ...over,
});
const site = (over: Partial<PausableSite> = {}): PausableSite => ({
  id: 's1',
  name: 'Bangkok Airways – Taiwan',
  tier: 1,
  owner: 'Arm',
  status: 'ok',
  mutedUntil: null,
  openIncident: null,
  ...over,
});
const muvmi = site({ name: 'MuvMi', status: 'down', openIncident: inc('unacked') });
const base = {
  later: false,
  startDate: '2026-09-26',
  startTime: '22:00',
  duration: '4 h',
  reason: 'CMS upgrade',
  now: NOW,
  isAdmin: false,
};

describe('maintenance dialog model (boards Maintenance, MMaintenance; §14.5, §15.1)', () => {
  it('words the end and the start days in Bangkok time', () => {
    expect(whenText(new Date('2026-09-25T07:07:00Z'), NOW)).toBe('14:07');
    expect(whenText(new Date('2026-09-26T19:00:00Z'), NOW)).toBe('Sun 27 Sep 02:00');
    expect(startDays(NOW).slice(0, 2)).toEqual([
      { value: '2026-09-25', label: 'Fri 25 Sep (today)' },
      { value: '2026-09-26', label: 'Sat 26 Sep' },
    ]);
    expect(bangkokInstant('2026-09-26', '22:00').toISOString()).toBe('2026-09-26T15:00:00.000Z');
  });

  it('the submit button reads as the board', () => {
    expect(submitLabel('maintenance', true, '4 h')).toBe('Schedule');
    expect(submitLabel('maintenance', false, '4 h')).toBe('Start now');
    expect(submitLabel('mute', false, '4 h')).toBe('Mute for 4 h');
  });

  it('Done-when 2: maintenance now on a DOWN site is blocked with the spec text; later is fine; mute is fine', () => {
    expect(busyOf(muvmi)).toBe('INC-0142');
    expect(guardTitle(muvmi)).toBe('MuvMi is DOWN now (INC-0142).');
    expect(planOf({ ...base, kind: 'maintenance', site: muvmi })).toMatchObject({ blocked: true });
    expect(planOf({ ...base, kind: 'maintenance', site: muvmi, later: true }).blocked).toBe(false);
    expect(planOf({ ...base, kind: 'mute', site: muvmi }).problems).toEqual([]);
    expect(
      guardTitle(
        site({ name: 'Fuji Links', status: 'problem', openIncident: inc('acknowledged', { number: 141 }) }),
      ),
    ).toBe('Fuji Links has an open PROBLEM (INC-0141).');
    expect(busyOf(site({ status: 'down' }))).toBe('down');
  });

  it('the mute rule while unacknowledged vs acknowledged (§15.1)', () => {
    expect(muteRule(inc('unacked')).title).toBe(
      'Mute stops new alerts only — INC-0142 keeps escalating until someone acknowledges.',
    );
    expect(muteRule(inc('acknowledged'))).toEqual({
      title: 'Mute stops new alerts only — INC-0142 stays open until it is resolved.',
      text: 'Already acknowledged by Ploy. Muting is not an acknowledgement and doesn’t resolve it.',
    });
  });

  it('Done-when 4: a Responder’s 30 h (3-day) window waits for an Admin; an Admin’s doesn’t; mutes stop at 24 h', () => {
    const later = { ...base, later: true, kind: 'maintenance' as const, site: site(), duration: '3 days' };
    expect(planOf(later).needsApproval).toBe(true);
    expect(planOf({ ...later, isAdmin: true }).needsApproval).toBe(false);
    // A mute never offers more than 24 h: an unknown length falls back to the longest it allows.
    const mute = planOf({ ...base, kind: 'mute', site: site(), duration: '3 days' });
    expect((mute.endsAt.getTime() - mute.startsAt.getTime()) / 3_600_000).toBe(24);
  });

  it('a reason is required before submit, and the hint says so', () => {
    expect(planOf({ ...base, kind: 'mute', site: site(), reason: ' ' }).problems).toEqual([
      'reason_required',
    ]);
    expect(reasonHint('', 'Mute for 4 h')).toBe(
      'Required — type a reason to enable “Mute for 4 h”. Shown on the dashboard and in the audit log.',
    );
    expect(reasonHint('x', 'Mute for 4 h')).toBe('Shown on the dashboard and in the audit log.');
  });

  it('a start in the past is refused', () => {
    expect(
      planOf({
        ...base,
        kind: 'maintenance',
        site: site(),
        later: true,
        startDate: '2026-09-25',
        startTime: '08:00',
      }).problems,
    ).toEqual(['starts_in_past']);
  });

  it('the success line names what happens and who it is recorded as', () => {
    const muted = doneOf({
      kind: 'mute',
      site: muvmi,
      startsAt: NOW,
      endsAt: new Date('2026-09-25T07:07:00Z'),
      later: false,
      needsApproval: false,
      reason: 'Known outage',
      viewer: 'Arm',
      now: NOW,
    });
    expect(muted.title).toBe('Muted · MuvMi');
    expect(muted.text).toContain(
      'Until 14:07 · new alerts suppressed, still counted in uptime · recorded in the audit log as Arm.',
    );
    expect(muted.text).toContain('INC-0142 is still escalating');
    const waiting = doneOf({
      kind: 'maintenance',
      site: site(),
      startsAt: new Date('2026-09-26T15:00:00Z'),
      endsAt: new Date('2026-09-29T15:00:00Z'),
      later: true,
      needsApproval: true,
      reason: 'Data-centre move',
      viewer: 'Arm',
      now: NOW,
    });
    expect(waiting.title).toBe('Waiting for approval · Bangkok Airways – Taiwan');
    const scheduled = doneOf({
      ...{
        kind: 'maintenance' as const,
        site: site(),
        later: true,
        needsApproval: false,
        reason: 'x',
        viewer: 'Tao',
        now: NOW,
      },
      startsAt: new Date('2026-09-26T15:00:00Z'),
      endsAt: new Date('2026-09-26T19:00:00Z'),
    });
    expect(scheduled).toMatchObject({ title: 'Maintenance scheduled · Bangkok Airways – Taiwan' });
    expect(scheduled.text).toMatch(
      /^Sat 26 Sep 22:00 → Sun 27 Sep 02:00 · alerts suppressed, not counted in uptime/,
    );
  });
});
