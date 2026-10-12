import { describe, expect, it } from 'vitest';
import {
  buildMutedMention,
  buildWindowEmail,
  type WindowEmailRole,
  type WindowEvent,
  type WindowFacts,
} from './maintenance-alerts';

// The redrawn EmailAlert maintenance threads (12 Oct 2026, spec §24.17): "Maintenance · request"
// (Bangkok Airways – China, asked by Arm, owner Arm, backup Ploy) and "Maintenance · window"
// (Tubtong, owner Ploy, backup Nok). Sample people and windows are the board's — test data only.
const bkk = (iso: string) => new Date(`${iso}+07:00`);
const page = 'https://monitor.example.test/maintenance';
const from = 'DxT Monitor <alerts@notify.example.test>';
const arm = { name: 'Arm', chatUserId: 'ARM' };
const ploy = { name: 'Ploy', chatUserId: 'PLOY' };
const nok = { name: 'Nok', chatUserId: 'NOK' };
const tao = { name: 'Tao', chatUserId: 'TAO' };

const china: WindowFacts = {
  windowId: 'w-china',
  site: 'Bangkok Airways – China',
  tier: 1,
  startsAt: bkk('2026-09-26T22:00'),
  endsAt: bkk('2026-09-29T22:00'),
  reason: 'Move to a new hosting provider',
  createdBy: 'Arm',
  createdAt: bkk('2026-09-25T09:20'),
  approvedBy: 'Tao',
  approvedAt: bkk('2026-09-25T10:07'),
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
  approvedBy: null,
  approvedAt: null,
  owner: ploy,
  backup: nok,
};
const ev = (action: WindowEvent['action'], at: Date, extra: Partial<WindowEvent> = {}): WindowEvent => ({
  action,
  at,
  by: null,
  ...extra,
});

interface Case {
  name: string;
  facts: WindowFacts;
  event: WindowEvent;
  role: WindowEmailRole;
  toIsAsker?: boolean;
  toIsAdmin?: boolean;
  request: boolean;
  /** "LABEL — headline" (the text part's first line). */
  head: string;
  pre: string;
  lede: string;
  changed: string;
  /** Rows that must, and must not, be there. */
  has?: string[];
  hasNot?: string[];
  why?: string;
  buttons?: string[];
}

const cases: Case[] = [
  {
    name: 'approved → the asker',
    facts: china,
    event: ev('approved', bkk('2026-09-25T10:07'), { by: 'Tao' }),
    role: 'owner',
    toIsAsker: true,
    request: true,
    head: 'MAINTENANCE APPROVED — Maintenance approved',
    pre: 'Bangkok Airways – China · Sat 26 Sep 22:00 → Tue 29 Sep 22:00 · by Tao',
    lede: 'Your request was approved. It starts on its own at Sat 26 Sep 22:00.',
    changed: 'Approved by Tao · Fri 25 Sep 10:07',
    has: [
      'When: Sat 26 Sep 22:00 → Tue 29 Sep 22:00 (3 days)',
      'Effect: No alerts; checks still run; not counted in uptime',
      'If it’s down: At the start it won’t start, and you’ll be told',
    ],
  },
  {
    name: 'approved → the backup',
    facts: china,
    event: ev('approved', bkk('2026-09-25T10:07'), { by: 'Tao' }),
    role: 'backup',
    request: true,
    head: 'MAINTENANCE APPROVED — Maintenance approved',
    pre: 'Bangkok Airways – China · Sat 26 Sep 22:00 → Tue 29 Sep 22:00 · by Tao',
    lede: 'Arm’s request was approved. Nothing to do — there will be no alerts for Bangkok Airways – China during the window.',
    changed: 'Approved by Tao · Fri 25 Sep 10:07',
    why: 'You got this because you’re backup for Bangkok Airways – China.',
  },
  {
    name: 'declined → the asker',
    facts: china,
    event: ev('declined', bkk('2026-09-25T10:07'), { by: 'Tao', reason: 'Split it into two nights' }),
    role: 'owner',
    toIsAsker: true,
    request: true,
    head: 'MAINTENANCE DECLINED — Maintenance declined',
    pre: 'Bangkok Airways – China · by Tao · “Split it into two nights”',
    lede: 'Your request was declined. Ask again with a shorter window — under 24 h needs no approval.',
    changed: 'Declined by Tao · Fri 25 Sep 10:07 · “Split it into two nights”',
    hasNot: ['Effect:', 'If it’s down'],
  },
  {
    name: 'declined → the backup',
    facts: china,
    event: ev('declined', bkk('2026-09-25T10:07'), { by: 'Tao', reason: 'Split it into two nights' }),
    role: 'backup',
    request: true,
    head: 'MAINTENANCE DECLINED — Maintenance declined',
    pre: 'Bangkok Airways – China · by Tao · “Split it into two nights”',
    lede: 'Arm’s request was declined. Nothing changes for Bangkok Airways – China.',
    changed: 'Declined by Tao · Fri 25 Sep 10:07 · “Split it into two nights”',
  },
  {
    name: 'request changed → an Admin',
    facts: { ...china, endsAt: bkk('2026-09-28T22:00') },
    event: ev('request_changed', bkk('2026-09-25T11:30'), {
      by: 'Arm',
      reason: 'Provider needs one day less',
      from: bkk('2026-09-29T22:00'),
      to: bkk('2026-09-28T22:00'),
    }),
    role: 'admin',
    request: true,
    head: 'REQUEST CHANGED — Request changed — now 2 days',
    pre: 'Bangkok Airways – China · ends Mon 28 Sep 22:00 (was Tue 29 Sep) · now 2 days · still waiting',
    lede: 'Arm changed the request while it waits. Review it as it stands now.',
    changed: 'Ends Mon 28 Sep 22:00 (was Tue 29 Sep 22:00) · by Arm 11:30 · “Provider needs one day less”',
    has: [
      'When: Sat 26 Sep 22:00 → Mon 28 Sep 22:00 (2 days)',
      'Effect: No alerts; checks still run; not counted in uptime',
      'Deadline: It starts only if approved before Sat 26 Sep 22:00',
    ],
    buttons: ['Review request'],
  },
  {
    name: 'request changed → the backup',
    facts: { ...china, endsAt: bkk('2026-09-28T22:00') },
    event: ev('request_changed', bkk('2026-09-25T11:30'), {
      by: 'Arm',
      reason: 'Provider needs one day less',
      from: bkk('2026-09-29T22:00'),
      to: bkk('2026-09-28T22:00'),
    }),
    role: 'backup',
    request: true,
    head: 'REQUEST CHANGED — Request changed — now 2 days',
    pre: 'Bangkok Airways – China · ends Mon 28 Sep 22:00 (was Tue 29 Sep) · now 2 days · still waiting',
    lede: 'Arm changed the request. An Admin still has to approve it.',
    changed: 'Ends Mon 28 Sep 22:00 (was Tue 29 Sep 22:00) · by Arm 11:30 · “Provider needs one day less”',
    buttons: ['Open Maintenance & mutes'],
  },
  {
    name: 'withdrawn → an Admin',
    facts: china,
    event: ev('withdrawn', bkk('2026-09-25T11:30'), { by: 'Arm', reason: 'Provider moved the date' }),
    role: 'admin',
    request: true,
    head: 'REQUEST WITHDRAWN — Request withdrawn',
    pre: 'Bangkok Airways – China · by Arm · no more reminders',
    lede: 'Nothing to approve any more.',
    changed: 'Withdrawn by Arm · Fri 25 Sep 11:30 · “Provider moved the date”',
    hasNot: ['Effect:'],
  },
  {
    name: 'withdrawn → the backup',
    facts: china,
    event: ev('withdrawn', bkk('2026-09-25T11:30'), { by: 'Arm', reason: 'Provider moved the date' }),
    role: 'backup',
    request: true,
    head: 'REQUEST WITHDRAWN — Request withdrawn',
    pre: 'Bangkok Airways – China · by Arm · no more reminders',
    lede: 'Arm withdrew the request. Nothing changes for Bangkok Airways – China.',
    changed: 'Withdrawn by Arm · Fri 25 Sep 11:30 · “Provider moved the date”',
  },
  {
    name: 'not approved → the asker',
    facts: china,
    event: ev('not_approved', bkk('2026-09-26T22:00')),
    role: 'owner',
    toIsAsker: true,
    request: true,
    head: 'NOT APPROVED — Not approved — it didn’t start',
    pre: 'Bangkok Airways – China · didn’t start · nobody approved before 22:00',
    lede: 'Your request wasn’t approved in time, so it didn’t start. Alerts stay on as usual. Ask again if you still need it.',
    changed: 'Nobody approved before Sat 26 Sep 22:00',
  },
  {
    name: 'not approved → the backup',
    facts: china,
    event: ev('not_approved', bkk('2026-09-26T22:00')),
    role: 'backup',
    request: true,
    head: 'NOT APPROVED — Not approved — it didn’t start',
    pre: 'Bangkok Airways – China · didn’t start · nobody approved before 22:00',
    lede: 'The window didn’t start. Alerts for Bangkok Airways – China stay on as usual.',
    changed: 'Nobody approved before Sat 26 Sep 22:00',
  },
  {
    name: 'not approved → an Admin',
    facts: china,
    event: ev('not_approved', bkk('2026-09-26T22:00')),
    role: 'admin',
    request: true,
    head: 'NOT APPROVED — Not approved — it didn’t start',
    pre: 'Bangkok Airways – China · didn’t start · nobody approved before 22:00',
    lede: 'The request lapsed without an answer.',
    changed: 'Nobody approved before Sat 26 Sep 22:00',
  },
  {
    name: 'started → the asker (a long window names the day)',
    facts: china,
    event: ev('started', bkk('2026-09-26T22:00')),
    role: 'owner',
    toIsAsker: true,
    request: true,
    head: 'MAINTENANCE STARTED — Maintenance has started',
    pre: 'Bangkok Airways – China · until Tue 29 Sep 22:00 · no alerts, not counted in uptime',
    lede: 'End it early or change the end on Maintenance & mutes.',
    changed: 'Started Sat 26 Sep 22:00',
    has: ['Effect: No alerts; checks still run; not counted in uptime'],
    hasNot: ['If it’s down'],
  },
  {
    name: 'started → the backup',
    facts: china,
    event: ev('started', bkk('2026-09-26T22:00')),
    role: 'backup',
    request: true,
    head: 'MAINTENANCE STARTED — Maintenance has started',
    pre: 'Bangkok Airways – China · until Tue 29 Sep 22:00 · no alerts, not counted in uptime',
    lede: 'Nothing to do — no alerts until Tue 29 Sep 22:00.',
    changed: 'Started Sat 26 Sep 22:00',
  },
  {
    name: 'didn’t start → the asker',
    facts: china,
    event: ev('didnt_start', bkk('2026-09-26T22:00'), {
      incident: {
        number: 155,
        severity: 'down',
        since: bkk('2026-09-26T21:52'),
        url: 'https://x.test/i/155',
      },
    }),
    role: 'owner',
    toIsAsker: true,
    request: true,
    head: 'DIDN’T START — Maintenance didn’t start — site was down',
    pre: 'Bangkok Airways – China was DOWN at 22:00 (INC-0155) · reschedule on Maintenance & mutes',
    lede: 'Your window didn’t start because the site was down. Deal with INC-0155 first, then schedule a new window.',
    changed: 'Didn’t start Sat 26 Sep 22:00 — DOWN since 21:52 (INC-0155)',
    has: ['Incident: INC-0155 stays open and keeps escalating — nothing was hidden'],
    buttons: ['Open incident', 'Open Maintenance & mutes'],
  },
  {
    name: 'didn’t start → the backup',
    facts: china,
    event: ev('didnt_start', bkk('2026-09-26T22:00'), {
      incident: {
        number: 155,
        severity: 'down',
        since: bkk('2026-09-26T21:52'),
        url: 'https://x.test/i/155',
      },
    }),
    role: 'backup',
    request: true,
    head: 'DIDN’T START — Maintenance didn’t start — site was down',
    pre: 'Bangkok Airways – China was DOWN at 22:00 (INC-0155) · reschedule on Maintenance & mutes',
    lede: 'The window didn’t start because the site was down.',
    changed: 'Didn’t start Sat 26 Sep 22:00 — DOWN since 21:52 (INC-0155)',
  },
  {
    name: 'didn’t start → the approver',
    facts: china,
    event: ev('didnt_start', bkk('2026-09-26T22:00'), {
      incident: {
        number: 155,
        severity: 'down',
        since: bkk('2026-09-26T21:52'),
        url: 'https://x.test/i/155',
      },
    }),
    role: 'approver',
    request: true,
    head: 'DIDN’T START — Maintenance didn’t start — site was down',
    pre: 'Bangkok Airways – China was DOWN at 22:00 (INC-0155) · reschedule on Maintenance & mutes',
    lede: 'The window you approved didn’t start because the site was down.',
    changed: 'Didn’t start Sat 26 Sep 22:00 — DOWN since 21:52 (INC-0155)',
    why: 'You got this because you approved this window.',
  },
  {
    name: 'changed → the backup',
    facts: { ...tubtong, endsAt: bkk('2026-09-29T04:00') },
    event: ev('changed', bkk('2026-09-28T15:10'), {
      by: 'Ploy',
      reason: 'Plugin conflict',
      from: bkk('2026-09-29T03:00'),
      to: bkk('2026-09-29T04:00'),
    }),
    role: 'backup',
    request: false,
    head: 'MAINTENANCE CHANGED — Tubtong maintenance now ends 04:00',
    pre: 'Tubtong · ends Tue 29 Sep 04:00 (was 03:00) · by Ploy',
    lede: 'Ploy changed the end time. Nothing to do.',
    changed: 'Ends Tue 29 Sep 04:00 (was 03:00) · by Ploy Mon 28 Sep 15:10 · “Plugin conflict”',
    has: [
      'When: Tue 29 Sep 01:00 → 04:00 (3 h)',
      'Effect: No alerts while it runs; checks still run; not counted in uptime',
      'If it’s down: At 01:00 it won’t start, and you’ll be told',
    ],
    why: 'You got this because you’re backup for Tubtong.',
  },
  {
    name: 'cancelled → the owner',
    facts: { ...tubtong, endsAt: bkk('2026-09-29T04:00') },
    event: ev('cancelled', bkk('2026-09-28T16:00'), { by: 'Tao', reason: 'Client postponed' }),
    role: 'owner',
    request: false,
    head: 'MAINTENANCE CANCELLED — Tubtong maintenance cancelled',
    pre: 'Tubtong · Tue 29 Sep 01:00 → 04:00 · by Tao · “Client postponed”',
    lede: 'Tao cancelled your window. Alerts for Tubtong stay on as usual.',
    changed: 'Cancelled by Tao · Mon 28 Sep 16:00 · “Client postponed”',
    hasNot: ['Effect:', 'If it’s down'],
  },
  {
    name: 'cancelled → the backup',
    facts: { ...tubtong, endsAt: bkk('2026-09-29T04:00') },
    event: ev('cancelled', bkk('2026-09-28T16:00'), { by: 'Tao', reason: 'Client postponed' }),
    role: 'backup',
    request: false,
    head: 'MAINTENANCE CANCELLED — Tubtong maintenance cancelled',
    pre: 'Tubtong · Tue 29 Sep 01:00 → 04:00 · by Tao · “Client postponed”',
    lede: 'The window was cancelled. Nothing to do.',
    changed: 'Cancelled by Tao · Mon 28 Sep 16:00 · “Client postponed”',
  },
  {
    name: 'started → the backup (a window inside one day reads in times)',
    facts: tubtong,
    event: ev('started', bkk('2026-09-29T01:00')),
    role: 'backup',
    request: false,
    head: 'MAINTENANCE STARTED — Tubtong maintenance has started',
    pre: 'Tubtong · until 03:00 · no alerts, not counted in uptime',
    lede: 'Nothing to do — no alerts until 03:00.',
    changed: 'Started 01:00',
  },
  {
    name: 'ended on time',
    facts: tubtong,
    event: ev('ended', bkk('2026-09-29T03:00')),
    role: 'owner',
    request: false,
    head: 'MAINTENANCE ENDED — Tubtong maintenance ended',
    pre: 'Tubtong · ended on time 03:00 · alerts back on',
    lede: 'Alerts for Tubtong are back on.',
    changed: 'Ended on time 03:00 · alerts back on',
    hasNot: ['Effect:'],
  },
];

describe('window emails per reader (EmailAlert, redrawn 12 Oct, §24.17)', () => {
  it.each(cases)('$name', (c) => {
    const e = buildWindowEmail({
      facts: c.facts,
      event: c.event,
      role: c.role,
      toIsAsker: c.toIsAsker,
      toIsAdmin: c.toIsAdmin,
      request: c.request,
      from,
      startsThread: false,
      now: c.event.at,
    });
    const label = c.head.split(' — ')[0]!;
    expect(e.text.split('\n')[0]).toBe(c.head);
    expect(e.html).toContain(`${label} — ${c.pre}`.replace(/&/g, '&amp;'));
    expect(e.text).toContain(c.lede);
    expect(e.text).toContain(`What changed: ${c.changed}`);
    for (const row of c.has ?? []) expect(e.text).toContain(row);
    for (const row of c.hasNot ?? []) expect(e.text).not.toContain(row);
    if (c.why) expect(e.text).toContain(c.why);
    if (c.buttons) {
      const shown = c.buttons.map((b) => e.text.indexOf(`${b}: `));
      expect(shown.every((i) => i >= 0)).toBe(true);
      expect([...shown].sort((a, b) => a - b)).toEqual(shown);
    }
  });

  it('colours: approved green, didn’t start red, the rest grey', () => {
    const colour = (action: WindowEvent['action'], extra: Partial<WindowEvent> = {}) =>
      /color:(#[0-9a-f]{6})">[A-Z’ ]+<\/div>/.exec(
        buildWindowEmail({
          facts: china,
          event: ev(action, bkk('2026-09-26T22:00'), { by: 'Tao', ...extra }),
          role: 'owner',
          toIsAsker: true,
          request: true,
          from,
          startsThread: false,
          now: bkk('2026-09-26T22:00'),
        }).html,
      )?.[1];
    expect(colour('approved')).toBe('#3f6212');
    expect(colour('didnt_start', { incident: { number: 155 } })).toBe('#b91c1c');
    expect(colour('not_approved')).toBe('#52525b');
    expect(colour('declined', { reason: 'x' })).toBe('#52525b');
  });

  it('an Admin who backs up the site still reviews the request (message-check M1)', () => {
    const e = buildWindowEmail({
      facts: china,
      event: ev('requested', china.createdAt, { by: 'Arm' }),
      role: 'backup',
      toIsAdmin: true,
      request: true,
      from,
      startsThread: true,
      now: china.createdAt,
    });
    expect(e.text).toContain(`Review request: ${page}`);
    expect(e.text).toContain('Windows over 24 h asked for by a Responder need an Admin.');
    // The why line keeps the closest tie (D-037).
    expect(e.text).toContain('You got this because you’re backup for Bangkok Airways – China.');
  });

  it('the not-approved Admin copy has a secondary button only', () => {
    const e = buildWindowEmail({
      facts: china,
      event: ev('not_approved', bkk('2026-09-26T22:00')),
      role: 'admin',
      request: true,
      from,
      startsThread: false,
      now: bkk('2026-09-26T22:00'),
    });
    expect(e.html).not.toMatch(
      /background:#18181b;border:1px solid #18181b;color:#ffffff;font-weight:600">Open/,
    );
  });
});

describe('MUTED reply naming owner and backup (ChatAlert "No Chat app yet")', () => {
  const muvmi: WindowFacts = {
    ...china,
    site: 'MuvMi',
    startsAt: bkk('2026-09-24T16:10'),
    endsAt: bkk('2026-09-24T18:00'),
    reason: 'Client changing DNS',
  };
  it('one line @mentioning both, without the length', () => {
    const m = buildMutedMention(
      muvmi,
      ev('muted', bkk('2026-09-24T16:10'), { by: 'Tao' }),
      [arm, ploy],
      bkk('2026-09-24T16:10'),
    );
    expect(m.text).toBe(
      '<users/ARM> <users/PLOY> MUTED · MuvMi · until 18:00 · “Client changing DNS” · by Tao · still counted in uptime',
    );
    expect(m.cardsV2).toEqual([]);
  });
  it('a person without a Chat id is left out of the mentions', () => {
    const m = buildMutedMention(
      muvmi,
      ev('muted', bkk('2026-09-24T16:10'), { by: 'Tao' }),
      [arm, { name: 'Ploy', chatUserId: null }],
      bkk('2026-09-24T16:10'),
    );
    expect(m.text.startsWith('<users/ARM> MUTED · MuvMi')).toBe(true);
  });
});
