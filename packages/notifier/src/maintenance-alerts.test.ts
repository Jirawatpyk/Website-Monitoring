import { describe, expect, it } from 'vitest';
import { buildDownAlert, buildProblemAlert } from './chat-alerts';
import {
  buildIncidentMutedLine,
  buildWindowDm,
  buildWindowEmail,
  buildWindowLine,
  windowThreadId,
  type WindowEvent,
  type WindowFacts,
} from './maintenance-alerts';

// Examples from the ChatAlert / EmailAlert maintenance states (spec §24, 11 Oct 2026). Sample
// people and windows are the boards' — test data only.
const bkk = (iso: string) => new Date(`${iso}+07:00`);
const arm = { name: 'Arm', chatUserId: 'ARM' };
const ploy = { name: 'Ploy', chatUserId: 'PLOY' };
const nok = { name: 'Nok', chatUserId: 'NOK' };
const tao = { name: 'Tao', chatUserId: 'TAO' };
const page = 'https://monitor.example.test/maintenance';

const china: WindowFacts = {
  windowId: 'w-china',
  site: 'Bangkok Airways – China',
  tier: 1,
  startsAt: bkk('2026-09-26T22:00'),
  endsAt: bkk('2026-09-29T22:00'),
  reason: 'Move to a new hosting provider',
  createdBy: 'Arm',
  createdAt: bkk('2026-09-25T09:20'),
  approvedBy: null,
  approvedAt: null,
  owner: arm,
  backup: ploy,
  admins: [tao],
  pageUrl: page,
};
const tubtong: WindowFacts = {
  ...china,
  windowId: 'w-tubtong',
  site: 'Tubtong',
  startsAt: bkk('2026-09-29T01:00'),
  endsAt: bkk('2026-09-29T03:00'),
  reason: 'WordPress plugin updates',
  createdBy: 'Ploy',
  createdAt: bkk('2026-09-23T16:30'),
  approvedBy: 'Ploy',
  owner: nok,
  backup: ploy,
};
const games: WindowFacts = {
  ...china,
  windowId: 'w-games',
  site: 'DxT Games',
  tier: 3,
  startsAt: bkk('2026-09-25T08:40'),
  endsAt: bkk('2026-09-25T18:00'),
  reason: 'Redeploying build',
  createdBy: 'Tao',
  approvedBy: 'Tao',
};
const ev = (action: WindowEvent['action'], at: Date, extra: Partial<WindowEvent> = {}): WindowEvent => ({
  action,
  at,
  by: null,
  ...extra,
});

describe('Alerts Space lines — one per action, no mention, no card (§24.4)', () => {
  it.each<[string, WindowFacts, WindowEvent, Date, string]>([
    [
      'requested',
      china,
      ev('requested', bkk('2026-09-25T09:20'), { by: 'Arm' }),
      bkk('2026-09-25T09:20'),
      'MAINTENANCE REQUESTED · Bangkok Airways – China · Sat 26 Sep 22:00 → Tue 29 Sep 22:00 (3 days) · “Move to a new hosting provider” · by Arm · waiting for an Admin',
    ],
    [
      'scheduled',
      tubtong,
      ev('scheduled', bkk('2026-09-23T16:30'), { by: 'Ploy' }),
      bkk('2026-09-23T16:30'),
      'MAINTENANCE SCHEDULED · Tubtong · Tue 29 Sep 01:00 → 03:00 (2 h) · “WordPress plugin updates” · by Ploy',
    ],
    [
      'approved',
      china,
      ev('approved', bkk('2026-09-25T10:07'), { by: 'Tao' }),
      bkk('2026-09-25T10:07'),
      'MAINTENANCE APPROVED · Bangkok Airways – China · by Tao',
    ],
    [
      'declined',
      china,
      ev('declined', bkk('2026-09-25T10:07'), { by: 'Tao', reason: 'Split it into two nights' }),
      bkk('2026-09-25T10:07'),
      'MAINTENANCE DECLINED · Bangkok Airways – China · by Tao · “Split it into two nights”',
    ],
    [
      'withdrawn',
      china,
      ev('withdrawn', bkk('2026-09-25T11:30'), { by: 'Arm', reason: 'Provider moved the date' }),
      bkk('2026-09-25T11:30'),
      'REQUEST WITHDRAWN · Bangkok Airways – China · by Arm · “Provider moved the date”',
    ],
    [
      'request changed',
      { ...china, endsAt: bkk('2026-09-28T22:00') },
      ev('request_changed', bkk('2026-09-25T11:30'), {
        by: 'Arm',
        from: bkk('2026-09-29T22:00'),
        to: bkk('2026-09-28T22:00'),
      }),
      bkk('2026-09-25T11:30'),
      'REQUEST CHANGED · Bangkok Airways – China · ends Mon 28 Sep 22:00 (was Tue 29 Sep) · now 2 days · by Arm · still waiting',
    ],
    [
      'changed',
      { ...tubtong, endsAt: bkk('2026-09-29T04:00') },
      ev('changed', bkk('2026-09-29T02:00'), {
        by: 'Ploy',
        reason: 'Plugin conflict',
        from: bkk('2026-09-29T03:00'),
        to: bkk('2026-09-29T04:00'),
      }),
      bkk('2026-09-29T02:00'),
      'MAINTENANCE CHANGED · Tubtong · ends 04:00 (was 03:00) · “Plugin conflict” · by Ploy',
    ],
    [
      'cancelled',
      tubtong,
      ev('cancelled', bkk('2026-09-24T10:00'), { by: 'Ploy', reason: 'Client postponed' }),
      bkk('2026-09-24T10:00'),
      'MAINTENANCE CANCELLED · Tubtong · Tue 29 Sep 01:00 · “Client postponed” · by Ploy',
    ],
    [
      'started',
      tubtong,
      ev('started', bkk('2026-09-29T01:00')),
      bkk('2026-09-29T01:00'),
      'MAINTENANCE STARTED · Tubtong · until 03:00 · no alerts, not counted in uptime',
    ],
    [
      'ended',
      tubtong,
      ev('ended', bkk('2026-09-29T03:00')),
      bkk('2026-09-29T03:00'),
      'MAINTENANCE ENDED · Tubtong · ended on time 03:00 · alerts back on',
    ],
    [
      'ended early',
      tubtong,
      ev('ended_early', bkk('2026-09-29T02:10'), { by: 'Ploy', reason: 'Updates finished' }),
      bkk('2026-09-29T02:10'),
      'MAINTENANCE ENDED EARLY · Tubtong · 02:10 by Ploy · “Updates finished” · alerts back on',
    ],
    [
      'not approved',
      china,
      ev('not_approved', bkk('2026-09-26T22:00')),
      bkk('2026-09-26T22:00'),
      'NOT APPROVED · Bangkok Airways – China · didn’t start',
    ],
    [
      'muted',
      games,
      ev('muted', bkk('2026-09-25T08:40'), { by: 'Tao' }),
      bkk('2026-09-25T08:40'),
      'MUTED · DxT Games · until 18:00 (9 h 20 min) · “Redeploying build” · by Tao · still counted in uptime',
    ],
    [
      'mute changed',
      { ...games, endsAt: bkk('2026-09-25T14:00') },
      ev('mute_changed', bkk('2026-09-25T10:00'), {
        by: 'Tao',
        reason: 'Build deployed sooner',
        from: bkk('2026-09-25T18:00'),
        to: bkk('2026-09-25T14:00'),
      }),
      bkk('2026-09-25T10:00'),
      'MUTE CHANGED · DxT Games · until 14:00 (was 18:00) · “Build deployed sooner” · by Tao',
    ],
    [
      'mute ended',
      games,
      ev('mute_ended', bkk('2026-09-25T18:00')),
      bkk('2026-09-25T18:00'),
      'MUTE ENDED · DxT Games · alerts back on',
    ],
    [
      'mute ended early',
      games,
      ev('mute_ended_early', bkk('2026-09-25T11:20'), { by: 'Tao', reason: 'Build deployed' }),
      bkk('2026-09-25T11:20'),
      'MUTE ENDED EARLY · DxT Games · 11:20 by Tao · “Build deployed” · alerts back on',
    ],
    [
      'mute ended with a silenced incident (§24.7)',
      { ...games, site: 'Bangkok Airways – Taiwan' },
      ev('mute_ended', bkk('2026-09-25T15:00'), {
        incident: { number: 154, severity: 'down', since: bkk('2026-09-25T14:20') },
      }),
      bkk('2026-09-25T15:00'),
      'MUTE ENDED · Bangkok Airways – Taiwan · alerts back on · INC-0154 posted (DOWN since 14:20)',
    ],
  ])('%s', (_label, facts, event, now, text) => {
    const message = buildWindowLine(facts, event, now);
    expect(message.text).toBe(text);
    expect(message.cardsV2).toEqual([]);
  });

  it('keeps people’s words from slipping in a mention or markup', () => {
    const message = buildWindowLine(
      { ...tubtong, reason: 'ping <users/all>' },
      ev('scheduled', tubtong.createdAt, { by: 'Ploy' }),
      tubtong.createdAt,
    );
    expect(message.text).not.toContain('<');
  });
});

describe('DIDN’T START (ChatAlert "Maintenance · didn’t start", §24.6)', () => {
  const approved = { ...china, approvedBy: 'Tao', approvedAt: bkk('2026-09-25T10:07') };
  const incident = {
    number: 155,
    since: bkk('2026-09-26T21:52'),
    url: 'https://monitor.example.test/incidents/i155',
  };

  it('@mentions the owner, the backup and the approver, with the card', () => {
    const m = buildWindowLine(
      approved,
      ev('didnt_start', bkk('2026-09-26T22:00'), { incident }),
      bkk('2026-09-26T22:00'),
    );
    expect(m.text).toBe(
      '<users/ARM> <users/PLOY> <users/TAO> DIDN’T START · Bangkok Airways – China · site was DOWN at 22:00 (INC-0155) · reschedule on Maintenance & mutes',
    );
    const c = m.cardsV2[0]!.card;
    expect(c.header.title).toBe('DIDN’T START · Bangkok Airways – China · site was DOWN at 22:00');
    expect(JSON.stringify(c)).toContain(
      'INC-0155 (DOWN since 21:52) stays open and keeps escalating — Bangkok Airways – China is Tier 1, 24/7. Nothing was hidden.',
    );
    expect(JSON.stringify(c)).toContain('Open INC-0155');
  });

  it('says the timers are paused for Tier 2–3 outside response hours', () => {
    const m = buildWindowLine(
      { ...approved, tier: 3 },
      ev('didnt_start', bkk('2026-09-26T22:00'), {
        incident: { ...incident, pausedUntil: bkk('2026-09-28T09:00') },
      }),
      bkk('2026-09-26T22:00'),
    );
    expect(JSON.stringify(m.cardsV2)).toContain('stays open; timers paused until Mon 28 Sep 09:00');
  });

  it('words a DOWN site with no incident open', () => {
    const m = buildWindowLine(
      approved,
      ev('didnt_start', bkk('2026-09-26T22:00'), { incident: { number: null } }),
      bkk('2026-09-26T22:00'),
    );
    expect(m.text).toContain('site was DOWN at 22:00 · reschedule');
  });
});

describe('"Direct messages" — replies that @mention the person (D-037)', () => {
  it('the request to each Admin (ChatAlert "approval request")', () => {
    const m = buildWindowDm(
      china,
      ev('requested', china.createdAt, { by: 'Arm' }),
      'requested',
      tao,
      china.createdAt,
    );
    expect(m.text).toBe(
      '<users/TAO> MAINTENANCE REQUESTED · Bangkok Airways – China · 3 days from Sat 26 Sep 22:00 · by Arm · approve before Sat 26 Sep 22:00',
    );
    const c = m.cardsV2[0]!.card;
    expect(c.header).toEqual({
      title: 'Maintenance request · Bangkok Airways – China',
      subtitle: 'Tier 1 · asked by Arm · Fri 25 Sep 09:20 (UTC+7)',
    });
    const rows = c.sections[0]!.widgets.flatMap((w) => ('decoratedText' in w ? [w.decoratedText] : []));
    expect(rows.map((r) => [r.topLabel, r.text])).toEqual([
      ['When', 'Sat 26 Sep 22:00 → Tue 29 Sep 22:00'],
      ['Length', '3 days'],
      ['Reason', '“Move to a new hosting provider”'],
      ['Effect', 'No alerts for 3 days; checks still run; not counted in uptime'],
      ['Deadline', 'It starts only if approved before Sat 26 Sep 22:00'],
    ]);
    expect(JSON.stringify(c)).toContain('Review on Maintenance & mutes');
    expect(JSON.stringify(c)).not.toMatch(/Approve"/);
  });

  it.each<[string, Parameters<typeof buildWindowDm>[2], typeof tao, Date, string]>([
    [
      '12 h reminder',
      'reminder_12h',
      tao,
      bkk('2026-09-26T10:00'),
      '<users/TAO> WAITING FOR APPROVAL · Bangkok Airways – China · starts in 12 h (Sat 26 Sep 22:00) · asked by Arm',
    ],
    [
      '1 h reminder',
      'reminder_1h',
      tao,
      bkk('2026-09-26T21:00'),
      '<users/TAO> WAITING FOR APPROVAL · Bangkok Airways – China · starts in 1 h (22:00) · last reminder · asked by Arm',
    ],
    [
      'still waiting',
      'still_waiting',
      arm,
      bkk('2026-09-26T10:00'),
      '<users/ARM> STILL WAITING · Bangkok Airways – China · starts in 12 h (Sat 26 Sep 22:00) · Tao reminded',
    ],
    [
      'not approved',
      'not_approved',
      arm,
      bkk('2026-09-26T22:00'),
      '<users/ARM> NOT APPROVED · Bangkok Airways – China · didn’t start · nobody approved before 22:00 · ask again on Maintenance & mutes',
    ],
  ])('%s', (_label, dm, to, now, text) => {
    expect(buildWindowDm(china, ev('requested', now), dm, to, now).text).toBe(text);
  });

  it('the answer to the asker: approved, with who is told if it can’t start', () => {
    const at = bkk('2026-09-25T10:07');
    const m = buildWindowDm(china, ev('approved', at, { by: 'Tao' }), 'approved', arm, at);
    expect(m.text).toBe(
      '<users/ARM> APPROVED · Bangkok Airways – China · Sat 26 Sep 22:00 → Tue 29 Sep 22:00 · by Tao',
    );
    const c = m.cardsV2[0]!.card;
    expect(c.header).toEqual({
      title: 'Approved · Bangkok Airways – China',
      subtitle: '3 days · Sat 26 Sep 22:00 → Tue 29 Sep 22:00 (UTC+7)',
    });
    expect(JSON.stringify(c)).toContain('At 22:00 it won’t start; you, Ploy and Tao are told');
    expect(JSON.stringify(c)).toContain('Tao · Fri 25 Sep 10:07');
  });

  it('declined, with the reason and the next step', () => {
    const at = bkk('2026-09-25T10:07');
    const m = buildWindowDm(
      china,
      ev('declined', at, { by: 'Tao', reason: 'Split it into two nights' }),
      'declined',
      arm,
      at,
    );
    expect(m.text).toBe(
      '<users/ARM> DECLINED · Bangkok Airways – China · Sat 26 Sep 22:00 → Tue 29 Sep 22:00 · by Tao · “Split it into two nights”',
    );
    expect(m.cardsV2[0]!.card.header.subtitle).toBe('Asked for 3 days from Sat 26 Sep 22:00');
    expect(JSON.stringify(m.cardsV2)).toContain(
      'Ask again with a shorter window — under 24 h needs no approval',
    );
  });

  it('MUTED to an owner when someone else muted the site', () => {
    const m = buildWindowDm(games, ev('muted', games.startsAt, { by: 'Tao' }), 'muted', arm, games.startsAt);
    expect(m.text).toBe(
      '<users/ARM> MUTED · DxT Games · until 18:00 (9 h 20 min) · “Redeploying build” · by Tao · still counted in uptime',
    );
  });

  it('names nobody when the person has no Chat id', () => {
    const m = buildWindowDm(
      china,
      ev('requested', china.createdAt),
      'requested',
      { name: 'Tao', chatUserId: null },
      china.createdAt,
    );
    expect(m.text.startsWith('MAINTENANCE REQUESTED · ')).toBe(true);
  });
});

describe('the incident thread when a mute starts (§24.4)', () => {
  it.each([
    [false, 'MUTED · MuvMi · until 18:00 · by Tao · INC-0142 keeps escalating until someone acknowledges'],
    [true, 'MUTED · MuvMi · until 18:00 · by Tao · INC-0142 stays open'],
  ])('acked %s', (acked, text) => {
    expect(
      buildIncidentMutedLine({
        site: 'MuvMi',
        incidentNumber: 142,
        until: bkk('2026-09-25T18:00'),
        by: 'Tao',
        acked,
        now: bkk('2026-09-25T10:00'),
      }).text,
    ).toBe(text);
  });
});

describe('maintenance emails (EmailAlert "Maintenance · approval", "owner & backup", §24.5)', () => {
  const from = 'DxT Monitor <alerts@notify.example.test>';

  it('the request: its own subject and thread, the Admin asked to review it', () => {
    const e = buildWindowEmail({
      facts: china,
      event: ev('requested', china.createdAt, { by: 'Arm' }),
      role: 'admin',
      request: true,
      from,
      startsThread: true,
      now: china.createdAt,
    });
    expect(e.subject).toBe('DxT Monitor · Maintenance request · Bangkok Airways – China · Sat 26 Sep 22:00');
    expect(e.headers).toEqual({ References: '<mw-w-china@notify.example.test>' });
    expect(e.text).toContain('MAINTENANCE REQUESTED — Arm asks for 3 days of maintenance');
    expect(e.text).toContain('Site: Bangkok Airways – China · Tier 1 · owner Arm, backup Ploy');
    expect(e.text).toContain('When: Sat 26 Sep 22:00 → Tue 29 Sep 22:00 (3 days)');
    expect(e.text).toContain('Deadline: It starts only if approved before Sat 26 Sep 22:00');
    expect(e.text).toContain(`Review request: ${page}`);
    expect(e.text).toContain('You got this because you’re an Admin.');
    expect(e.html).toContain(
      'Arm asks for 3 days of maintenance on Bangkok Airways – China from Sat 26 Sep 22:00',
    );
  });

  it('the backup gets the same request, told why', () => {
    const e = buildWindowEmail({
      facts: china,
      event: ev('requested', china.createdAt, { by: 'Arm' }),
      role: 'backup',
      request: true,
      from,
      startsThread: true,
      now: china.createdAt,
    });
    expect(e.text).toContain('You got this because you’re backup for Bangkok Airways – China.');
    expect(e.text).toContain(`Open Maintenance & mutes: ${page}`);
  });

  it('the 12 h reminder replies in the request thread', () => {
    const now = bkk('2026-09-26T10:00');
    const e = buildWindowEmail({
      facts: china,
      event: { action: 'reminder_12h', at: now, by: null },
      role: 'admin',
      request: true,
      from,
      startsThread: false,
      now,
    });
    expect(e.headers).toEqual({
      'In-Reply-To': '<mw-w-china@notify.example.test>',
      References: '<mw-w-china@notify.example.test>',
    });
    expect(e.text).toContain('WAITING FOR APPROVAL — Still waiting — starts in 12 h');
    expect(e.text).toContain('A last reminder comes by Chat at 21:00.');
    expect(e.text).toContain(
      'If nobody answers: At 22:00 it doesn’t start; Arm is told and has to ask again',
    );
  });

  it('a scheduled window to its owner (the scheduler gets none)', () => {
    const e = buildWindowEmail({
      facts: tubtong,
      event: ev('scheduled', tubtong.createdAt, { by: 'Ploy' }),
      role: 'owner',
      request: false,
      from,
      startsThread: true,
      now: tubtong.createdAt,
    });
    expect(e.subject).toBe('Tubtong · Maintenance · Tue 29 Sep 01:00');
    expect(e.html).toContain('MAINTENANCE SCHEDULED — Tubtong · Tue 29 Sep 01:00 → 03:00 (2 h) · by Ploy');
    expect(e.text).toContain('MAINTENANCE SCHEDULED — Tubtong maintenance on Tue 29 Sep');
    expect(e.text).toContain('Scheduled by: Ploy · Wed 23 Sep 16:30');
    expect(e.text).toContain('If it’s down: At 01:00 it won’t start, and you’ll be told');
    expect(e.text).toContain('You got this because you own Tubtong.');
  });

  it('a later action keeps the layout and adds "What changed"', () => {
    const at = bkk('2026-09-29T02:10');
    const e = buildWindowEmail({
      facts: tubtong,
      event: ev('ended_early', at, { by: 'Ploy', reason: 'Updates finished' }),
      role: 'owner',
      request: false,
      from,
      startsThread: false,
      now: at,
    });
    expect(e.subject).toBe('Tubtong · Maintenance · Tue 29 Sep 01:00');
    expect(e.text).toContain('MAINTENANCE ENDED EARLY — Tubtong maintenance ended early');
    expect(e.text).toContain(
      'What changed: Ended Tue 29 Sep 02:10 by Ploy · “Updates finished” · alerts back on',
    );
    // Over: its effect and "if it's down" no longer apply.
    expect(e.text).not.toContain('If it’s down');
    expect(e.text).not.toContain('Effect:');
  });

  it('escapes people’s words in the HTML', () => {
    const e = buildWindowEmail({
      facts: { ...tubtong, reason: '<b>x</b>' },
      event: ev('scheduled', tubtong.createdAt, { by: 'Ploy' }),
      role: 'owner',
      request: false,
      from,
      startsThread: true,
      now: tubtong.createdAt,
    });
    expect(e.html).not.toContain('<b>x');
  });

  it('threads every email of a window on one id', () => {
    expect(windowThreadId('abc', from)).toBe('<mw-abc@notify.example.test>');
  });
});

describe('first alert after a mute (ChatAlert "First alert after a mute", §24.7)', () => {
  const base = {
    incidentId: 'i154',
    incidentNumber: 154,
    site: 'Bangkok Airways – Taiwan',
    tier: 1,
    confirmedAt: bkk('2026-09-25T14:20:36'),
    now: bkk('2026-09-25T15:00'),
    cause: 'HTTP 503 (BKK, SIN, TYO)',
    confirmingLocations: 3,
    owner: arm,
    backup: ploy,
    incidentUrl: 'https://monitor.example.test/incidents/i154',
  };

  it('says the mute held it, and escalation starts now', () => {
    const m = buildDownAlert({
      ...base,
      heldUntil: bkk('2026-09-25T15:00'),
      ladder: { next: { level: 1, at: bkk('2026-09-25T15:15'), ask: ['Ploy'], fyi: ['Tao'] } },
    });
    expect(m.text).toBe(
      '<users/ARM> DOWN · Bangkok Airways – Taiwan (Tier 1) · held by a mute until 15:00 · acknowledge by 15:15 or it escalates',
    );
    const widgets = m.cardsV2[0]!.card.sections[0]!.widgets;
    expect(widgets[0]).toEqual({
      textParagraph: { text: 'Held by a mute until 15:00 · escalation starts now' },
    });
    expect(m.cardsV2[0]!.card.header.subtitle).toContain('Confirmed down 14:20:36');
    expect(JSON.stringify(widgets)).toContain('Down 40 min so far — the time while muted counts in uptime.');
  });

  it('outside response hours: escalation starts when the timers run again', () => {
    const m = buildDownAlert({
      ...base,
      site: 'DxT Games',
      tier: 3,
      now: bkk('2026-09-25T18:00'),
      heldUntil: bkk('2026-09-25T18:00'),
      ladder: { pausedUntil: bkk('2026-09-28T09:00') },
    });
    expect(m.text).toBe(
      '<users/ARM> DOWN · DxT Games (Tier 3) · held by a mute until 18:00 · timers paused until Mon 28 Sep 09:00',
    );
    expect(m.cardsV2[0]!.card.sections[0]!.widgets[0]).toEqual({
      textParagraph: {
        text: 'Held by a mute until 18:00 · outside response hours — escalation starts Mon 28 Sep 09:00',
      },
    });
  });

  it('a PROBLEM card gets the same line', () => {
    const m = buildProblemAlert({
      incidentId: 'i9',
      incidentNumber: 9,
      site: 'Fuji Links',
      tier: 2,
      trigger: 'slow',
      detectedAt: bkk('2026-09-25T14:20'),
      now: bkk('2026-09-25T15:00'),
      cause: 'Slow',
      summary: 'slow · 6.2 s',
      seenFrom: null,
      owner: arm,
      backup: null,
      incidentUrl: 'u',
      heldUntil: bkk('2026-09-25T15:00'),
      ladder: { next: null },
    });
    // A PROBLEM's next step is a reminder: it keeps "please take a look", not "acknowledge by".
    expect(m.text).toBe(
      '<users/ARM> PROBLEM · Fuji Links (Tier 2) · slow · 6.2 s · held by a mute until 15:00 · please take a look',
    );
    expect(m.cardsV2[0]!.card.sections[0]!.widgets[0]).toEqual({
      textParagraph: { text: 'Held by a mute until 15:00 · escalation starts now' },
    });
  });

  it('a PROBLEM held to the next morning names the mute’s day; no ladder, no promise', () => {
    const m = buildProblemAlert({
      incidentId: 'i9',
      incidentNumber: 9,
      site: 'Fuji Links',
      tier: 2,
      trigger: 'slow',
      detectedAt: bkk('2026-09-25T17:20'),
      now: bkk('2026-09-28T09:00'),
      cause: 'Slow',
      summary: 'slow · 6.2 s',
      seenFrom: null,
      owner: arm,
      backup: null,
      incidentUrl: 'u',
      heldUntil: bkk('2026-09-25T18:00'),
    });
    expect(m.text).toContain('held by a mute until Fri 25 Sep 18:00');
    expect(m.cardsV2[0]!.card.sections[0]!.widgets[0]).toEqual({
      textParagraph: { text: 'Held by a mute until Fri 25 Sep 18:00' },
    });
  });
});

describe('review fixes: acknowledged, PROBLEM and held incidents in window lines', () => {
  const approved = { ...china, approvedBy: 'Tao', approvedAt: bkk('2026-09-25T10:07') };

  it('DIDN’T START on an acknowledged PROBLEM: it stays open, words it as a PROBLEM', () => {
    const now = bkk('2026-09-26T22:00');
    const m = buildWindowLine(
      approved,
      ev('didnt_start', now, {
        incident: { number: 155, severity: 'problem', since: bkk('2026-09-26T21:52'), acked: true },
      }),
      now,
    );
    expect(m.text).toContain('site had a PROBLEM at 22:00 (INC-0155)');
    expect(JSON.stringify(m.cardsV2)).toContain(
      'INC-0155 (PROBLEM since 21:52) stays open — it is acknowledged.',
    );
    expect(JSON.stringify(m.cardsV2)).not.toContain('keeps escalating');
  });

  it('MUTE ENDED with a PROBLEM held for response hours says when it posts', () => {
    const now = bkk('2026-09-25T18:00');
    const m = buildWindowLine(
      games,
      ev('mute_ended', now, {
        incident: {
          number: 154,
          severity: 'problem',
          since: bkk('2026-09-25T17:00'),
          pausedUntil: bkk('2026-09-28T09:00'),
        },
      }),
      now,
    );
    expect(m.text).toBe(
      'MUTE ENDED · DxT Games · alerts back on · INC-0154 posts Mon 28 Sep 09:00 (PROBLEM since 17:00)',
    );
  });
});
