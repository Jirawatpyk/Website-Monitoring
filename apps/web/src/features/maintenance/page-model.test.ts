import { describe, expect, it } from 'vitest';
import {
  approveEffects,
  approveTitle,
  cancelText,
  countdown,
  dialogDescription,
  endChoices,
  endEffects,
  lengthText,
  logLine,
  metaOf,
  overviewOf,
  pageRow,
  phoneLine,
  sectionsOf,
  spanText,
  windowEvents,
  type Viewer,
  type WindowRow,
} from './page-model';

// Fri 25 Sep 2026 10:07 (UTC+7) — the boards' "now" (spec §1); sample rows from MaintenancePage.
const NOW = new Date('2026-09-25T03:07:00Z');
const bkk = (iso: string) => new Date(`${iso}+07:00`).toISOString();
const tao: Viewer = { id: 'u-tao', name: 'Tao', role: 'admin' };
const arm: Viewer = { id: 'u-arm', name: 'Arm', role: 'responder' };
const mint: Viewer = { id: 'u-mint', name: 'Mint', role: 'readonly' };

const row = (over: Partial<WindowRow> = {}): WindowRow => ({
  id: 'w1',
  siteId: 's1',
  siteName: 'WeCare Studio',
  tier: 2,
  siteStatus: 'maintenance',
  kind: 'maintenance',
  startsAt: bkk('2026-09-25T09:30:00'),
  endsAt: bkk('2026-09-25T14:00:00'),
  approvedAt: bkk('2026-09-24T16:05:00'),
  approvedById: 'u-nok',
  endedAt: null,
  cancelledAt: null,
  createdAt: bkk('2026-09-24T16:05:00'),
  createdById: 'u-nok',
  outcome: null,
  outcomeDetail: null,
  reason: 'CMS upgrade',
  endReason: null,
  byName: 'Nok',
  ownerName: 'Nok',
  backupName: 'Ploy',
  ownerIds: ['u-nok', 'u-ploy'],
  log: [],
  ...over,
});
const wecare = row();
const games = row({
  id: 'w2',
  siteName: 'DxT Games',
  tier: 3,
  siteStatus: 'ok',
  kind: 'mute',
  startsAt: bkk('2026-09-25T08:40:00'),
  endsAt: bkk('2026-09-25T18:00:00'),
  reason: 'Redeploying build',
  byName: 'Tao',
  createdById: 'u-tao',
  approvedById: 'u-tao',
  ownerName: 'Tao',
  backupName: 'Nok',
  ownerIds: ['u-tao', 'u-nok'],
});
const bac = row({
  id: 'w3',
  siteName: 'Bangkok Airways – China',
  tier: 1,
  siteStatus: 'ok',
  startsAt: bkk('2026-09-26T22:00:00'),
  endsAt: bkk('2026-09-29T22:00:00'),
  approvedAt: null,
  approvedById: null,
  createdAt: bkk('2026-09-25T09:20:00'),
  createdById: 'u-arm',
  reason: 'Move to a new hosting provider',
  byName: 'Arm',
  ownerName: 'Arm',
  backupName: 'Ploy',
  ownerIds: ['u-arm', 'u-ploy'],
});
const tub = row({
  id: 'w4',
  siteName: 'Tubtong',
  siteStatus: 'ok',
  startsAt: bkk('2026-09-29T01:00:00'),
  endsAt: bkk('2026-09-29T03:00:00'),
  reason: 'WordPress plugin updates',
  byName: 'Ploy',
  createdById: 'u-ploy',
  approvedById: 'u-ploy',
  ownerName: 'Ploy',
  backupName: 'Nok',
  ownerIds: ['u-ploy', 'u-nok'],
});
const cando = row({
  id: 'w5',
  siteName: 'Cando Asia',
  siteStatus: 'ok',
  kind: 'mute',
  startsAt: bkk('2026-09-21T10:15:00'),
  endsAt: bkk('2026-09-21T14:15:00'),
  endedAt: bkk('2026-09-21T11:40:00'),
  reason: 'Client changing DNS',
  log: [{ at: bkk('2026-09-21T11:40:00'), action: 'ended_early', by: 'Nok', reason: 'DNS change confirmed' }],
});
const ROWS = [wecare, games, bac, tub, cando];

describe('/maintenance sections and rows (spec §23, board MaintenancePage)', () => {
  it('sections in order, each sorted; the meta counts', () => {
    const s = sectionsOf(ROWS, tao, NOW);
    expect(s.map((x) => x.title)).toEqual([
      'Active now',
      'Waiting for approval',
      'Scheduled',
      'Recent · last 30 days',
    ]);
    expect(s[0]!.rows.map((r) => r.row.siteName)).toEqual(['WeCare Studio', 'DxT Games']);
    expect(metaOf(s)).toBe('2 active · 1 scheduled · 1 waiting for approval');
    expect(metaOf(sectionsOf([], tao, NOW))).toBe('Nothing active, scheduled or waiting');
    expect(sectionsOf([], tao, NOW)).toEqual([]);
  });

  it('a running maintenance row reads as the board', () => {
    const p = pageRow(wecare, tao, NOW);
    expect(p.badge).toEqual({ tone: 'accent', variant: 'soft', icon: 'calendar', label: 'Maintenance' });
    expect(p.siteSub).toBe('Tier 2 · Nok · backup Ploy');
    expect(p.when).toBe('Today 09:30 → 14:00');
    expect(p.whenSub).toBe('4 h 30 min · 37 min in');
    expect(p.whySub).toBe('by Nok · not counted in uptime');
    expect([p.canEnd, p.editLabel]).toEqual([true, 'Edit end']);
  });

  it('a running mute keeps the real status with the overlay', () => {
    const p = pageRow(games, tao, NOW);
    expect(p.badge).toBeNull();
    expect(p.mutedLabel).toBe('Muted · until 18:00');
    expect(p.whenSub).toBe('until 18:00 (max 24 h) · 1 h 27 min in');
    expect(p.whySub).toBe('by Tao · still counted in uptime');
  });

  it('a request: Admin approves or declines; the asker edits or withdraws; others read', () => {
    const admin = pageRow(bac, tao, NOW);
    expect(admin.badge?.label).toBe('Needs approval');
    expect(admin.when).toBe('Sat 26 Sep 22:00 → Tue 29 Sep 22:00');
    expect(admin.whenSub).toBe('3 days · starts in 1 d 12 h');
    expect(admin.whySub).toBe('asked by Arm · today 09:20');
    expect([admin.canApprove, admin.editLabel]).toEqual([true, null]);
    const asker = pageRow(bac, arm, NOW);
    expect([asker.canApprove, asker.editLabel, asker.note]).toEqual([
      false,
      'Edit / withdraw',
      'Waiting for an Admin',
    ]);
    expect(pageRow(bac, mint, NOW).note).toBeNull();
  });

  it('scheduled: Edit / cancel for those who may; who can act for the others', () => {
    expect(pageRow(tub, tao, NOW)).toMatchObject({
      editLabel: 'Edit / cancel',
      whenSub: '2 h · starts in 3 d 15 h',
    });
    expect(pageRow(tub, arm, NOW)).toMatchObject({ editLabel: null, note: 'Only Ploy, Nok or an Admin' });
    expect(pageRow(wecare, arm, NOW).note).toBe('Only Nok, Ploy or an Admin');
    expect(pageRow(wecare, mint, NOW)).toMatchObject({ canEnd: false, note: null });
  });

  it('recent rows say what happened', () => {
    const p = pageRow(cando, tao, NOW);
    expect(p.badge).toMatchObject({ label: 'Ended early', icon: 'eye-off', variant: 'outline' });
    expect(p.when).toBe('Mon 21 Sep 10:15 → 11:40');
    expect(p.whenSub).toBe('Mute · 1 h 25 min');
    expect(p.logs).toEqual(['Ended early Mon 21 Sep 11:40 by Nok · “DNS change confirmed”']);
    const declined = pageRow(
      row({ approvedAt: null, cancelledAt: bkk('2026-09-25T09:00:00'), outcome: 'declined' }),
      tao,
      NOW,
    );
    expect(declined.badge?.label).toBe('Declined');
    expect(declined.whenSub).toBe('Maintenance · 4 h 30 min · didn’t start');
  });
});

describe('words', () => {
  it.each([
    [{ at: bkk('2026-09-25T10:07:00'), action: 'approved', by: 'Tao' }, 'Approved 10:07 by Tao'],
    [
      {
        at: bkk('2026-09-25T10:07:00'),
        action: 'edited',
        by: 'Tao',
        from: bkk('2026-09-25T14:00:00'),
        to: bkk('2026-09-25T16:00:00'),
        reason: 'more time',
      },
      'End 14:00 → 16:00 · 10:07 by Tao · “more time”',
    ],
    [{ at: bkk('2026-09-22T22:00:00'), action: 'ended' }, 'Ended on time 22:00'],
    [
      { at: bkk('2026-09-12T22:00:00'), action: 'not_approved' },
      'Not approved — didn’t start · nobody approved before Sat 12 Sep 22:00',
    ],
    [
      { at: bkk('2026-09-25T09:30:00'), action: 'didnt_start', incident: 'INC-0142' },
      'Didn’t start — site was DOWN (INC-0142)',
    ],
    [
      { at: bkk('2026-09-25T09:30:00'), action: 'withdrawn', by: 'Arm', reason: 'x' },
      'Withdrawn 09:30 by Arm · “x”',
    ],
    [
      { at: bkk('2026-09-25T09:30:00'), action: 'declined', by: 'Tao', reason: 'x' },
      'Declined 09:30 by Tao · “x”',
    ],
    [{ at: bkk('2026-09-25T09:30:00'), action: 'cancelled', by: 'Tao' }, 'Cancelled 09:30 by Tao'],
    [{ at: bkk('2026-09-25T09:30:00'), action: 'ended_by_maintenance' }, 'Ended 09:30 — maintenance started'],
    [{ at: bkk('2026-09-25T09:30:00'), action: 'created', by: 'Tao' }, null],
  ])('log %#', (e, line) => {
    expect(logLine(e, NOW)).toBe(line);
  });

  it('lengths, countdowns and spans', () => {
    expect([lengthText(4320), lengthText(1440), lengthText(270), lengthText(1500)]).toEqual([
      '3 days',
      '24 h',
      '4 h 30 min',
      '1 d 1 h',
    ]);
    expect([countdown(37), countdown(2213)]).toEqual(['37 min', '1 d 13 h']);
    expect(spanText(new Date(bkk('2026-09-29T01:00:00')), new Date(bkk('2026-09-29T03:00:00')), NOW)).toBe(
      'Tue 29 Sep 01:00 → 03:00',
    );
  });

  it('dialog words', () => {
    expect(dialogDescription(wecare, NOW)).toBe('Today 09:30 → 14:00 · CMS upgrade · by Nok');
    expect(dialogDescription(bac, NOW)).toContain('asked by Arm');
    expect(endEffects(wecare, 'Tao', NOW)[1]).toBe(
      'Checks from 10:07 count in uptime again; 09:30–10:07 stays excluded.',
    );
    expect(endEffects(games, 'Tao', NOW)[1]).toBe('Uptime is unaffected — muted time was already counted.');
    expect(approveTitle(bac)).toBe('Approve 3 days of maintenance?');
    expect(approveEffects(bac, 'Tao', NOW)[0]).toBe(
      'Starts Sat 26 Sep 22:00, ends Tue 29 Sep 22:00 (3 days). Bangkok Airways – China is Tier 1.',
    );
    expect(cancelText('waiting', 'Arm')).toContain('Withdraws the request');
    expect(cancelText('scheduled', 'Arm')).toContain('cancelling removes it');
    const ends = endChoices(games, NOW);
    expect(ends.find((e) => e.label.endsWith('(current)'))?.label).toBe('18:00 (current)');
    expect(ends.every((e) => Date.parse(e.value) <= Date.parse(games.startsAt) + 24 * 3_600_000)).toBe(true);
  });
});

describe('Overview (§23.8)', () => {
  it('active rows, waiting (Admin only) and the next scheduled; the phone line', () => {
    const o = overviewOf(ROWS, true, NOW)!;
    expect(o.active.map((a) => a.title)).toEqual(['WeCare Studio — maintenance', 'DxT Games — muted']);
    expect(o.active[1]!.detail).toBe('until 18:00 · Redeploying build · by Tao · still counted in uptime');
    expect([o.waiting, o.scheduled, o.nextScheduled]).toEqual([1, 1, 'Tue 29 Sep 01:00']);
    expect(overviewOf(ROWS, false, NOW)!.waiting).toBe(0);
    expect(phoneLine(o)).toBe('2 active · 1 scheduled');
    expect(overviewOf([cando], true, NOW)).toBeNull();
    expect(phoneLine(null)).toBeNull();
  });

  it('Recent events lines from the last day', () => {
    const lines = windowEvents(
      [
        bac,
        row({
          log: [{ at: bkk('2026-09-25T09:15:00'), action: 'ended_early', by: 'Tao' }],
          siteName: 'DxT Games',
          kind: 'mute',
        }),
      ],
      NOW,
    ).map((e) => e.text);
    expect(lines).toContain('Bangkok Airways – China maintenance Sat 26 Sep 22:00 → Tue 29 Sep 22:00 — Arm');
    expect(lines).toContain('DxT Games mute ended early — Tao');
  });
});
