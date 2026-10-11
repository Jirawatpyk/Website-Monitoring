import { describe, expect, it } from 'vitest';
import {
  activeWindow,
  checkWindow,
  maintenanceSpans,
  windowEnd,
  windowState,
  type MaintenanceWindow,
} from './maintenance';

// Fri 25 Sep 2026 10:07 (UTC+7) — the boards' "now" (spec §1).
const NOW = new Date('2026-09-25T03:07:00Z');
const at = (iso: string) => new Date(`${iso}+07:00`);
const H = 3_600_000;

const win = (over: Partial<MaintenanceWindow> = {}): MaintenanceWindow => ({
  kind: 'maintenance',
  startsAt: at('2026-09-25T09:30:00'),
  endsAt: at('2026-09-25T14:00:00'),
  approvedAt: at('2026-09-24T16:05:00'),
  endedAt: null,
  cancelledAt: null,
  ...over,
});

describe('windowState (D-036, mirrors SQL window_state)', () => {
  it.each<[string, Partial<MaintenanceWindow>, ReturnType<typeof windowState>]>([
    ['WeCare Studio 09:30 → 14:00 at 10:07 (Main board)', {}, 'active'],
    [
      'approved, starts later',
      { startsAt: at('2026-09-26T22:00:00'), endsAt: at('2026-09-27T02:00:00') },
      'scheduled',
    ],
    [
      'over 24 h, not approved yet',
      { startsAt: at('2026-09-26T22:00:00'), endsAt: at('2026-09-29T22:00:00'), approvedAt: null },
      'waiting',
    ],
    ['nobody approved it before its start', { approvedAt: null }, 'not_approved'],
    ['ended early at 10:00', { endedAt: at('2026-09-25T10:00:00') }, 'ended'],
    ['ran its course', { endsAt: at('2026-09-25T10:00:00') }, 'ended'],
    ['cancelled', { cancelledAt: at('2026-09-25T09:00:00') }, 'cancelled'],
    [
      'set aside by the engine at its start, unapproved',
      { approvedAt: null, cancelledAt: at('2026-09-25T09:30:00'), outcome: 'not_approved' },
      'not_approved',
    ],
    [
      'a request withdrawn before its start',
      { approvedAt: null, cancelledAt: at('2026-09-25T09:00:00'), outcome: 'withdrawn' },
      'withdrawn',
    ],
    ['a request declined', { approvedAt: null, cancelledAt: NOW, outcome: 'declined' }, 'declined'],
    [
      'didn’t start — the site was DOWN',
      { cancelledAt: at('2026-09-25T09:30:00'), outcome: 'didnt_start' },
      'didnt_start',
    ],
    ['the start minute itself is active', { startsAt: NOW }, 'active'],
    ['the end minute itself has ended', { endsAt: NOW }, 'ended'],
  ])('%s → %s', (_, over, state) => {
    expect(windowState(win(over), NOW)).toBe(state);
  });

  it('a window ended early ends at its real end', () => {
    expect(windowEnd(win({ endedAt: at('2026-09-25T10:00:00') }))).toEqual(at('2026-09-25T10:00:00'));
    expect(windowEnd(win())).toEqual(at('2026-09-25T14:00:00'));
  });

  it('activeWindow picks the running window of a kind', () => {
    const mute = win({
      kind: 'mute',
      startsAt: at('2026-09-25T08:40:00'),
      endsAt: at('2026-09-25T18:00:00'),
    });
    const later = win({ startsAt: at('2026-09-26T22:00:00'), endsAt: at('2026-09-27T02:00:00') });
    expect(activeWindow([later, mute], 'maintenance', NOW)).toBeNull();
    expect(activeWindow([later, mute], 'mute', NOW)).toBe(mute);
    expect(activeWindow([later, win()], 'maintenance', NOW)).toEqual(win());
  });
});

describe('checkWindow (§14.5, §15.1, FR-10a, FR-14)', () => {
  const base = { now: NOW, reason: 'CMS upgrade', siteBusy: null, isAdmin: false } as const;

  it('a reason is required', () => {
    expect(
      checkWindow({ ...base, kind: 'mute', startsAt: NOW, endsAt: new Date(+NOW + H), reason: '  ' })
        .problems,
    ).toEqual(['reason_required']);
  });

  it.each([
    ['24 h', 24, []],
    ['25 h', 25, ['mute_too_long']],
  ])('a %s mute → %j (max 24 h)', (_, hours, problems) => {
    expect(
      checkWindow({ ...base, kind: 'mute', startsAt: NOW, endsAt: new Date(+NOW + hours * H) }).problems,
    ).toEqual(problems);
  });

  it('a mute on a DOWN site is fine — it stops new alerts only (§15.1)', () => {
    const r = checkWindow({
      ...base,
      kind: 'mute',
      startsAt: NOW,
      endsAt: new Date(+NOW + 4 * H),
      siteBusy: 'INC-0142',
    });
    expect(r.problems).toEqual([]);
  });

  it('maintenance now on a DOWN site or one with an open incident is refused (§14.5)', () => {
    const r = checkWindow({
      ...base,
      kind: 'maintenance',
      startsAt: NOW,
      endsAt: new Date(+NOW + 4 * H),
      siteBusy: 'INC-0142',
    });
    expect(r.problems).toEqual(['maintenance_open_incident']);
  });

  it('maintenance later on that site is allowed (it doesn’t overlap now)', () => {
    const r = checkWindow({
      ...base,
      kind: 'maintenance',
      startsAt: at('2026-09-26T22:00:00'),
      endsAt: at('2026-09-27T02:00:00'),
      siteBusy: 'INC-0142',
    });
    expect(r.problems).toEqual([]);
  });

  it.each([
    ['a Responder’s 30 h window waits for an Admin', false, 30, true],
    ['an Admin’s own 3-day window needs no approval', true, 72, false],
    ['24 h exactly needs no approval', false, 24, false],
  ])('%s', (_, isAdmin, hours, needsApproval) => {
    const r = checkWindow({
      ...base,
      isAdmin,
      kind: 'maintenance',
      startsAt: at('2026-09-26T22:00:00'),
      endsAt: new Date(+at('2026-09-26T22:00:00') + hours * H),
    });
    expect(r).toEqual({ problems: [], needsApproval });
  });

  it('the end must be after the start; a start in the past is refused; 31 days at most', () => {
    expect(checkWindow({ ...base, kind: 'maintenance', startsAt: NOW, endsAt: NOW }).problems).toEqual([
      'ends_before_start',
    ]);
    expect(
      checkWindow({ ...base, kind: 'maintenance', startsAt: new Date(+NOW - H), endsAt: new Date(+NOW + H) })
        .problems,
    ).toEqual(['starts_in_past']);
    expect(
      checkWindow({
        ...base,
        isAdmin: true,
        kind: 'maintenance',
        startsAt: NOW,
        endsAt: new Date(+NOW + 32 * 24 * H),
      }).problems,
    ).toEqual(['too_long']);
  });
});

describe('maintenanceSpans (spec §5, D-036)', () => {
  it('an approved window that ran is excluded, to its real end', () => {
    expect(maintenanceSpans([win({ endedAt: at('2026-09-25T10:07:00') })], [])).toEqual([
      { start: at('2026-09-25T09:30:00'), end: at('2026-09-25T10:07:00') },
    ]);
  });

  it('a mute, a window nobody approved and one cancelled before it started exclude nothing', () => {
    expect(
      maintenanceSpans(
        [win({ kind: 'mute' }), win({ approvedAt: null }), win({ cancelledAt: at('2026-09-25T09:00:00') })],
        [],
      ),
    ).toEqual([]);
  });

  it('a running window cancelled at 10:07 keeps 09:30–10:07 excluded (Main board)', () => {
    const w = win({ cancelledAt: at('2026-09-25T10:07:00'), endedAt: at('2026-09-25T10:07:00') });
    expect(maintenanceSpans([w], [])).toEqual([
      { start: at('2026-09-25T09:30:00'), end: at('2026-09-25T10:07:00') },
    ]);
  });

  it('a window that started while an incident was open hides nothing (§14.5)', () => {
    const incident = { start: at('2026-09-25T09:00:00'), end: null };
    expect(maintenanceSpans([win()], [incident])).toEqual([]);
    const closedBefore = { start: at('2026-09-25T08:00:00'), end: at('2026-09-25T09:00:00') };
    expect(maintenanceSpans([win()], [closedBefore])).toHaveLength(1);
  });
});
