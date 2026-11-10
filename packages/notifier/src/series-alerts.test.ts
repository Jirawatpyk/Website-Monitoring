import { describe, expect, it } from 'vitest';
import { buildWindowLine, type WindowFacts } from './maintenance-alerts';
import {
  buildSeriesDm,
  buildSeriesEmail,
  buildSeriesLine,
  seriesThreadId,
  type SeriesEvent,
  type SeriesFacts,
} from './series-alerts';

// ChatAlert "Maintenance · repeating series" (spec §32 sample, Fri 25 Sep 2026 10:07). Made up — the
// words are the board's.
const bkk = (s: string) => new Date(`${s}:00+07:00`);
const now = bkk('2026-09-25T10:07');
const tao = { name: 'Tao', chatUserId: 'TAO' };
const arm = { name: 'Arm', chatUserId: 'ARM' };
const base = {
  tier: 1,
  untilOn: null,
  createdAt: bkk('2026-09-14T09:10'),
  owner: { name: 'Ploy', chatUserId: 'PLOY' },
  backup: { name: 'Nok', chatUserId: 'NOK' },
  admins: [tao],
  pageUrl: 'https://monitor.example/maintenance',
};
const tubtong: SeriesFacts = {
  ...base,
  seriesId: 's-tub',
  site: 'Tubtong',
  rule: { freq: 'weekly', days: [2] },
  startTime: '01:00:00',
  durationMin: 120,
  startsOn: '2026-09-15',
  firstStartsAt: bkk('2026-09-15T01:00'),
  reason: 'WordPress plugin updates',
  createdBy: 'Ploy',
};
const orca: SeriesFacts = {
  ...base,
  seriesId: 's-orca',
  site: 'ORCA Thailand',
  rule: { freq: 'monthly', day: 6 },
  startTime: '20:00:00',
  durationMin: 120,
  startsOn: '2026-09-06',
  untilOn: '2026-12-31',
  firstStartsAt: bkk('2026-09-06T20:00'),
  reason: 'Hosting security patches',
  createdBy: 'Tao',
};
const airways: SeriesFacts = {
  ...base,
  seriesId: 's-ba',
  site: 'Bangkok Airways – Taiwan',
  rule: { freq: 'weekly', days: [1, 4] },
  startTime: '22:00:00',
  durationMin: 60,
  startsOn: '2026-09-28',
  firstStartsAt: bkk('2026-09-28T22:00'),
  reason: 'Cache purge and log rotation',
  createdBy: 'Arm',
  createdAt: bkk('2026-09-25T09:50'),
};
const ev = (e: Partial<SeriesEvent> & Pick<SeriesEvent, 'action'>): SeriesEvent => ({
  at: now,
  by: 'Tao',
  ...e,
});

describe('series thread lines (ChatAlert, §32.10)', () => {
  it.each([
    [
      'REQUESTED',
      tubtong,
      ev({ action: 'requested', by: 'Ploy' }),
      'MAINTENANCE REQUESTED · Tubtong · every Tue 01:00 → 03:00 (2 h) · from Tue 15 Sep · “WordPress plugin updates” · by Ploy · waiting for an Admin',
    ],
    [
      'APPROVED',
      tubtong,
      ev({ action: 'approved', windows: [bkk('2026-09-15T01:00'), bkk('2026-09-22T01:00')] }),
      'MAINTENANCE APPROVED · Tubtong · series every Tue · by Tao · 2 windows scheduled (Tue 15 Sep, Tue 22 Sep)',
    ],
    [
      'CANCELLED',
      tubtong,
      ev({
        action: 'cancelled',
        reason: 'Plugins now update automatically',
        cancelled: [bkk('2026-09-29T01:00'), bkk('2026-10-06T01:00')],
      }),
      'MAINTENANCE CANCELLED · Tubtong · series every Tue 01:00 → 03:00 · 2 not started cancelled (Tue 29 Sep, Tue 6 Oct) · “Plugins now update automatically” · by Tao',
    ],
    [
      'SCHEDULED (monthly, with an end)',
      orca,
      ev({ action: 'scheduled' }),
      'MAINTENANCE SCHEDULED · ORCA Thailand · monthly on day 6 · 20:00 → 22:00 (2 h) · from Sun 6 Sep · until Thu 31 Dec · “Hosting security patches” · by Tao',
    ],
    [
      'SKIPPED',
      orca,
      ev({
        action: 'skipped',
        by: null,
        skip: {
          startsAt: bkk('2026-10-06T20:00'),
          endsAt: bkk('2026-10-06T22:00'),
          next: bkk('2026-11-06T20:00'),
          overlap: {
            startsAt: bkk('2026-10-06T18:00'),
            endsAt: bkk('2026-10-06T23:00'),
            reason: 'Data-centre move',
          },
        },
      }),
      'MAINTENANCE SKIPPED · ORCA Thailand · Tue 6 Oct 20:00 → 22:00 · overlaps the 18:00 → 23:00 window (“Data-centre move”) · next Fri 6 Nov',
    ],
    [
      'REQUEST WITHDRAWN',
      airways,
      ev({ action: 'withdrawn', by: 'Arm', reason: 'Host does it now' }),
      'REQUEST WITHDRAWN · Bangkok Airways – Taiwan · series every Mon, Thu · by Arm · “Host does it now” · no more reminders',
    ],
    [
      'NOT APPROVED',
      airways,
      ev({ action: 'not_approved', by: null }),
      'NOT APPROVED · Bangkok Airways – Taiwan · series every Mon, Thu · nothing scheduled · nobody approved before Mon 28 Sep 22:00 · ask again on Maintenance & mutes',
    ],
  ] as const)('%s', (_name, facts, event, text) => {
    expect(buildSeriesLine(facts, event)).toEqual({ text, cardsV2: [] });
  });

  it('names a window that was too soon to start, and a cancel with one running', () => {
    expect(
      buildSeriesLine(
        tubtong,
        ev({ action: 'approved', windows: [bkk('2026-10-06T01:00')], tooSoon: [bkk('2026-09-29T01:00')] }),
      ).text,
    ).toBe(
      'MAINTENANCE APPROVED · Tubtong · series every Tue · by Tao · 1 window scheduled (Tue 6 Oct) · Tue 29 Sep was too soon',
    );
    expect(
      buildSeriesLine(tubtong, ev({ action: 'cancelled', reason: 'x', cancelled: [], running: true })).text,
    ).toBe(
      'MAINTENANCE CANCELLED · Tubtong · series every Tue 01:00 → 03:00 · none waiting to start · the running window finishes · “x” · by Tao',
    );
  });

  it('keeps people’s words from slipping in a mention or markup', () => {
    const text = buildSeriesLine({ ...tubtong, reason: '<users/all> hi' }, ev({ action: 'scheduled' })).text;
    expect(text).not.toContain('<');
  });
});

describe('series replies @mentioning one person (§24.1–3, "series every Mon, Thu")', () => {
  it('the request to each Admin, with the repeating request card', () => {
    const m = buildSeriesDm(airways, ev({ action: 'requested', by: 'Arm' }), 'requested', tao, now);
    expect(m.text).toBe(
      '<users/TAO> MAINTENANCE REQUESTED · Bangkok Airways – Taiwan · every Mon, Thu 22:00 → 23:00 (1 h) · from Mon 28 Sep · by Arm · approve before Mon 28 Sep 22:00',
    );
    const card = m.cardsV2[0]!.card;
    expect(card.header).toEqual({
      title: 'Repeating maintenance request · Bangkok Airways – Taiwan',
      subtitle: 'Tier 1 · asked by Arm · Fri 25 Sep 09:50 (UTC+7)',
    });
    const rows = card.sections[0]!.widgets.flatMap((w) =>
      'decoratedText' in w && w.decoratedText ? [[w.decoratedText.topLabel, w.decoratedText.text]] : [],
    );
    expect(rows).toEqual([
      ['Repeats', 'Every Mon, Thu 22:00 → 23:00 (1 h each)'],
      ['From', 'Mon 28 Sep · no end date'],
      ['Reason', '“Cache purge and log rotation”'],
      ['Effect', 'Each window: no alerts; checks still run; not counted in uptime'],
      ['Deadline', 'Approve before the first window, Mon 28 Sep 22:00 — otherwise nothing is scheduled'],
    ]);
  });

  it.each([
    [
      'approved',
      ev({
        action: 'approved',
        windows: ['2026-09-28T22:00', '2026-10-01T22:00', '2026-10-05T22:00', '2026-10-08T22:00'].map(bkk),
      }),
      '<users/ARM> APPROVED · Bangkok Airways – Taiwan · series every Mon, Thu 22:00 → 23:00 · by Tao 10:07 · 4 windows scheduled, to Thu 8 Oct',
    ],
    [
      'declined',
      ev({ action: 'declined', reason: 'Make it one night a week' }),
      '<users/ARM> DECLINED · Bangkok Airways – Taiwan · series every Mon, Thu · by Tao 10:07 · “Make it one night a week”',
    ],
    [
      'not_approved',
      ev({ action: 'not_approved', by: null }),
      '<users/ARM> NOT APPROVED · Bangkok Airways – Taiwan · series every Mon, Thu · nothing scheduled · nobody approved before Mon 28 Sep 22:00 · ask again on Maintenance & mutes',
    ],
  ] as const)('%s to the asker', (dm, event, text) => {
    expect(buildSeriesDm(airways, event, dm, arm, now).text).toBe(text);
  });

  it('the reminders count down to the first window', () => {
    const at12 = bkk('2026-09-28T10:00');
    expect(buildSeriesDm(airways, ev({ action: 'requested' }), 'reminder_12h', tao, at12).text).toBe(
      '<users/TAO> WAITING FOR APPROVAL · Bangkok Airways – Taiwan · series every Mon, Thu · first window in 12 h (Mon 28 Sep 22:00) · asked by Arm',
    );
    expect(
      buildSeriesDm(airways, ev({ action: 'requested' }), 'reminder_1h', tao, bkk('2026-09-28T21:00')).text,
    ).toBe(
      '<users/TAO> WAITING FOR APPROVAL · Bangkok Airways – Taiwan · series every Mon, Thu · first window in 1 h (22:00) · last reminder · asked by Arm',
    );
    expect(buildSeriesDm(airways, ev({ action: 'requested' }), 'still_waiting', arm, at12).text).toBe(
      '<users/ARM> STILL WAITING · Bangkok Airways – Taiwan · series every Mon, Thu · first window in 12 h (Mon 28 Sep 22:00) · Tao reminded',
    );
  });
});

describe('a series window’s first line (§32.10)', () => {
  const w: WindowFacts = {
    windowId: 'w-1',
    site: 'Tubtong',
    tier: 1,
    startsAt: bkk('2026-09-29T01:00'),
    endsAt: bkk('2026-09-29T03:00'),
    reason: 'WordPress plugin updates',
    createdBy: 'Ploy',
    createdAt: bkk('2026-09-14T09:10'),
    approvedBy: 'Tao',
    approvedAt: bkk('2026-09-14T11:20'),
    owner: base.owner,
    backup: base.backup,
    admins: [tao],
    pageUrl: base.pageUrl,
    series: 'every Tue',
  };
  const t = bkk('2026-09-29T01:00');
  it('STARTED ends "· series every Tue"; ENDED is unchanged', () => {
    expect(buildWindowLine(w, { action: 'started', at: t, by: null }, t).text).toBe(
      'MAINTENANCE STARTED · Tubtong · until 03:00 · no alerts, not counted in uptime · series every Tue',
    );
    expect(buildWindowLine(w, { action: 'ended', at: t, by: null }, t).text).toBe(
      'MAINTENANCE ENDED · Tubtong · ended on time 03:00 · alerts back on',
    );
  });
  it('so does DIDN’T START', () => {
    expect(buildWindowLine(w, { action: 'didnt_start', at: t, by: null, incident: null }, t).text).toMatch(
      / · reschedule on Maintenance & mutes · series every Tue$/,
    );
  });
});

describe('series emails (§32.11: the window layout, "Repeats" instead of When)', () => {
  const email = (
    event: Parameters<typeof buildSeriesEmail>[0]['event'],
    role: 'owner' | 'backup' | 'admin',
    request = false,
  ) =>
    buildSeriesEmail({
      facts: tubtong,
      event,
      role,
      request,
      from: 'alerts@notify.example',
      startsThread: true,
      now,
    });

  it('one email to owner and backup when scheduled, in the series’ own thread', () => {
    const m = email(ev({ action: 'scheduled', by: 'Ploy' }), 'backup');
    expect(m.subject).toBe('Tubtong · Maintenance · series every Tue');
    expect(m.headers).toEqual({ References: seriesThreadId('s-tub', 'alerts@notify.example') });
    expect(m.html).toContain('Every Tue 01:00 → 03:00 (2 h each)');
    expect(m.html).toContain('You got this because you’re backup for Tubtong.');
    expect(seriesThreadId('s-tub', 'alerts@notify.example')).toBe('<ms-s-tub@notify.example>');
  });

  it('a request goes in its request thread to the Admins, with the deadline', () => {
    const m = email(ev({ action: 'requested', by: 'Ploy' }), 'admin', true);
    expect(m.subject).toBe('DxT Monitor · Maintenance request · Tubtong · series every Tue');
    expect(m.html).toContain('Approve before the first window, Tue 15 Sep 01:00');
    expect(m.html).toContain('Review request');
  });

  it.each([
    [
      'approved',
      ev({ action: 'approved', windows: [bkk('2026-09-15T01:00')] }),
      'Repeating maintenance approved',
    ],
    ['declined', ev({ action: 'declined', reason: 'No' }), 'Repeating maintenance declined'],
    [
      'cancelled',
      ev({ action: 'cancelled', reason: 'Done', cancelled: [bkk('2026-09-29T01:00')] }),
      'Repeating maintenance cancelled',
    ],
    ['withdrawn', ev({ action: 'withdrawn', reason: 'Not needed' }), 'Request withdrawn'],
    ['not_approved', ev({ action: 'not_approved', by: null }), 'Not approved — nothing scheduled'],
    [
      'reminder_12h',
      { action: 'reminder_12h', at: now, by: null } as const,
      'Still waiting — first window in',
    ],
  ] as const)('%s', (_kind, event, headline) => {
    expect(email(event, 'owner').html).toContain(headline);
  });

  it('escapes people’s words', () => {
    const m = buildSeriesEmail({
      facts: { ...tubtong, reason: '<b>x</b>' },
      event: ev({ action: 'scheduled' }),
      role: 'owner',
      request: false,
      from: 'alerts@notify.example',
      startsThread: false,
      now,
    });
    expect(m.html).not.toContain('<b>x</b>');
    expect(m.headers['In-Reply-To']).toBe('<ms-s-tub@notify.example>');
  });
});
