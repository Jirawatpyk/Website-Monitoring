// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { IncidentFacts, Notification } from './facts';
import { renderChat, renderEmail, renderSystemAlertEmail } from './render';

// The PROBLEM thread (spec §19, D-022) as the notifier renders a claimed row.
const incident: IncidentFacts = {
  id: 'inc-141',
  number: 141,
  state: 'unacked',
  severity: 'problem',
  trigger: 'slow',
  started_at: '2026-09-25T02:48:00Z',
  detected_at: '2026-09-25T02:52:00Z',
  acked_at: null,
  recovered_at: '2026-09-25T03:14:00Z',
  acker: null,
  sites: {
    name: 'Fuji Links',
    tier: 2,
    primary: { id: 'u-ploy', display_name: 'Ploy', google_chat_user_id: 'PLOY' },
    backup: { id: 'u-nok', display_name: 'Nok', google_chat_user_id: 'NOK' },
  },
};
const row = (template: string, context: Notification['context'] = {}): Notification =>
  ({
    id: 'n1',
    incident_id: 'inc-141',
    system_alert_id: null,
    user_id: 'u-ploy',
    channel: 'google_chat',
    template,
    context,
    created_at: '2026-09-25T02:52:01Z',
  }) as Notification;
const appUrl = 'https://monitor.example.test';
const ploy = { id: 'u-ploy', email: 'ploy@example.test', display_name: 'Ploy' };
const now = new Date('2026-09-25T02:52:05Z');
const problemContext = {
  cause: 'p50 5.8 s (BKK, SIN, TYO) · over the Tier 2 limit of 5 s for 3 checks in a row',
  summary: 'slow, p50 5.8 s',
  detail: { kind: 'slow', p50Ms: 5800, thresholdMs: 5000, locations: ['BKK', 'SIN', 'TYO'] },
  reporting: 3,
};

describe('render — the person on call L0 paged (S10, D-048)', () => {
  const tle = { id: 'u-tle', display_name: 'Tle', google_chat_user_id: 'TLE' };
  const night: IncidentFacts = {
    ...incident,
    sites: { ...incident.sites, tier: 1 },
    l0: { ...tle, is_active: true, role: 'responder' },
  };
  const thread = { threadId: '<inc-inc-141@notify.example.test>', startsThread: true };

  it('@mentions the person on call instead of the owner, and the email says why they got it', () => {
    const m = renderChat(row('problem', problemContext), night, appUrl, now)!;
    expect(m.text).toMatch(/^<users\/TLE> PROBLEM · Fuji Links \(Tier 1\)/);
    const email = renderEmail(
      { ...row('problem', problemContext), user_id: 'u-tle', channel: 'email' },
      night,
      { id: 'u-tle', email: 'tle@example.test', display_name: 'Tle' },
      appUrl,
      thread,
    )!;
    expect(email.text).toContain('You’re on call — please take a look');
    expect(email.text).toContain(
      'You got this because you were on call when Fuji Links (Tier 1) alerted outside response hours.',
    );
    expect(email.text).not.toContain('you own');
    // ChatAlert night: who acts, and the owner who isn't paged.
    const card = JSON.stringify(m.cardsV2);
    expect(card).toContain('Tle (Tier 1, outside response hours) — the person who acts');
    expect(card).toContain('Ploy · not paged outside response hours');
  });

  it('someone the L0 pencil adds gets RECOVERED as "you were emailed", and isn\u2019t asked for the root cause', () => {
    const plan = {
      severity: 'problem',
      tier: 1,
      reminderMin: 60,
      steps: [
        { level: 0, delayMin: 0, targets: ['owner', 'backup'], channels: ['chat', 'space', 'email'] },
        { level: 1, delayMin: 60, targets: ['admins'], channels: ['chat', 'email'] },
      ],
    };
    const rec = renderEmail(
      { ...row('recovered', { okLocations: 3 }), user_id: 'u-nok', channel: 'email' },
      { ...night, escalation_plan: plan },
      { id: 'u-nok', email: 'nok@example.test', display_name: 'Nok' },
      appUrl,
      thread,
    )!;
    expect(rec.text).toContain('You got this because you were emailed about this incident.');
    expect(rec.text).not.toContain('couldn’t be delivered');
    expect(rec.text).not.toContain('Add root cause');
  });

  it('the L0 pencil: the first card @mentions everyone L0 names, owner / on-call first', () => {
    const plan = {
      severity: 'problem',
      tier: 1,
      reminderMin: 60,
      steps: [
        { level: 0, delayMin: 0, targets: ['owner', 'backup'], channels: ['chat', 'space', 'email'] },
        { level: 1, delayMin: 60, targets: ['admins'], channels: ['chat', 'email'] },
      ],
    };
    const m = renderChat(row('problem', problemContext), { ...night, escalation_plan: plan }, appUrl, now)!;
    expect(m.text).toMatch(/^<users\/TLE> <users\/NOK> PROBLEM · Fuji Links/);
  });

  it('falls back to the owner once the person on call is deactivated or no longer a Responder', () => {
    for (const l0 of [
      { ...tle, is_active: false, role: 'responder' },
      { ...tle, is_active: true, role: 'viewer' },
    ]) {
      const m = renderChat(row('problem', problemContext), { ...night, l0 }, appUrl, now)!;
      expect(m.text).toMatch(/^<users\/PLOY> PROBLEM/);
    }
  });
});

describe('render — PROBLEM rows', () => {
  it('renders the PROBLEM card with the stored cause, summary and where it was seen', () => {
    const m = renderChat(row('problem', problemContext), incident, appUrl, now)!;
    expect(m.text).toBe('<users/PLOY> PROBLEM · Fuji Links (Tier 2) · slow, p50 5.8 s · please take a look');
    expect(JSON.stringify(m.cardsV2)).toContain('3 of 3 locations — the site loads, just slowly');
    expect(JSON.stringify(m.cardsV2)).toContain('https://monitor.example.test/incidents/inc-141?ack=1');
  });

  it('a crawler-view PROBLEM names the view and shows no "Seen from" locations row (S09c, D-042)', () => {
    const m = renderChat(
      row('problem', {
        cause: 'Found “บาคาร่า” on / (as Googlebot)',
        summary: '“บาคาร่า” found on the page (as Googlebot)',
        detail: { kind: 'keyword', missing: [], forbidden: ['บาคาร่า'], locations: [], view: 'googlebot' },
        reporting: 3,
      }),
      { ...incident, trigger: 'keyword' },
      appUrl,
      now,
    )!;
    expect(m.text).toBe(
      '<users/PLOY> PROBLEM · Fuji Links (Tier 2) · “บาคาร่า” found on the page (as Googlebot) · please take a look',
    );
    const card = JSON.stringify(m.cardsV2);
    expect(card).toContain('Found “บาคาร่า” on / (as Googlebot)');
    expect(card).not.toContain('Seen from');
  });

  it('words ACKNOWLEDGED and RECOVERED of a PROBLEM as one, and keeps DOWN as it was', () => {
    const ack = renderChat(
      row('acknowledged', { ackedBy: 'Ploy', ackedAt: '2026-09-25T02:58:12Z' }),
      incident,
      appUrl,
      now,
    )!;
    expect(ack.cardsV2[0]!.card.header.title).toBe('ACKNOWLEDGED · Fuji Links still slow · by Ploy 09:58');
    const rec = renderChat(row('recovered', { okLocations: 3 }), incident, appUrl, now)!;
    expect(rec.text).toContain('problem cleared after 26 min');
    expect(JSON.stringify(rec.cardsV2)).toContain('Response time back under 5 s from 3 locations.');
    const down = renderChat(
      row('recovered', { okLocations: 3 }),
      { ...incident, severity: 'down' },
      appUrl,
      now,
    )!;
    expect(down.text).toContain('down 26 min');
  });

  it('emails the owner the PROBLEM, then ACKNOWLEDGED and RECOVERED in its thread', () => {
    const to = { id: 'u-ploy', email: 'ploy@example.test', display_name: 'Ploy' };
    const thread = { threadId: '<inc-inc-141@notify.example.test>', startsThread: true };
    const first = renderEmail(row('problem', problemContext), incident, to, appUrl, thread)!;
    expect(first.text).toMatch(/^PROBLEM — Fuji Links is slow/);
    expect(first.text).toContain('You got this because you own Fuji Links.');
    const ack = renderEmail(
      row('acknowledged', { ackedBy: 'Ploy', ackedAt: '2026-09-25T02:58:12Z' }),
      incident,
      to,
      appUrl,
      { ...thread, startsThread: false },
    )!;
    expect(ack.text).toContain('Slow for:');
    const rec = renderEmail(row('recovered', { okLocations: 3 }), incident, to, appUrl, thread)!;
    expect(rec.text).toMatch(/^RECOVERED — Fuji Links is back to normal/);
  });

  it('renders the fewer-than-2-locations Admin email from the alert context', () => {
    const m = renderSystemAlertEmail(
      {
        ...row('probe_locations_low'),
        incident_id: null,
        system_alert_id: 'a1',
        channel: 'email',
      } as Notification,
      {
        id: 'a1',
        kind: 'probe_locations_low',
        opened_at: '2026-09-22T08:40:00Z',
        context: { active: ['TYO', 'XX'] },
      },
      'DxT Monitor <alerts@notify.example.test>',
    )!;
    expect(m.subject).toBe('DxT Monitor · System · Fewer than 2 probe locations · Tue 22 Sep 15:40');
    expect(m.text).toContain('Still reporting: TYO (Tokyo)');
  });
});

describe('render — mutes (S09b, §24.4, §24.7)', () => {
  it('a late first alert says the mute held it', () => {
    const m = renderChat(
      row('problem', { ...problemContext, afterMute: true, heldUntil: '2026-09-25T08:00:00Z' }),
      incident,
      appUrl,
      new Date('2026-09-25T08:00:05Z'),
    )!;
    expect(m.text).toContain('held by a mute until 15:00');
    expect(JSON.stringify(m.cardsV2)).toContain('Held by a mute until 15:00');
  });

  it('a card that isn’t after a mute keeps its words', () => {
    const m = renderChat(
      row('problem', { ...problemContext, heldUntil: '2026-09-25T08:00:00Z' }),
      incident,
      appUrl,
      now,
    )!;
    expect(m.text).not.toContain('held by a mute');
  });

  it('a mute on a site with an open incident adds its line to the thread', () => {
    const m = renderChat(
      row('muted', { until: '2026-09-25T11:00:00Z', by: 'Tao', acked: false }),
      incident,
      appUrl,
      now,
    )!;
    expect(m.text).toBe(
      'MUTED · Fuji Links · until 18:00 · by Tao · INC-0141 keeps escalating until someone acknowledges',
    );
    expect(renderChat(row('muted', {}), incident, appUrl, now)).toBeNull();
  });
});

describe('render — relapse, flapping and auto-resolve rows (S04b, D-024)', () => {
  const voca: IncidentFacts = {
    ...incident,
    id: 'inc-133',
    number: 133,
    state: 'unacked',
    severity: 'down',
    trigger: 'hard_fail',
    started_at: '2026-09-20T20:12:00Z',
    detected_at: '2026-09-20T20:12:40Z',
    recovered_at: null,
    sites: { ...incident.sites, name: 'VOCA' },
    incident_events: [
      { type: 'detected', payload: {}, at: '2026-09-20T20:12:40Z' },
      { type: 'recovered', payload: {}, at: '2026-09-20T20:19:00Z' },
      {
        type: 'relapsed',
        payload: { startedAt: '2026-09-20T20:24:00Z', severity: 'down' },
        at: '2026-09-20T20:24:40Z',
      },
    ],
  };

  it('ACKNOWLEDGED email after a relapse: "Down for" is the drops so far (7 + 6 min), as the incident page (D-033)', () => {
    const ack = renderEmail(
      row('acknowledged', { ackedBy: 'Ploy', ackedAt: '2026-09-20T20:30:10Z' }),
      voca,
      ploy,
      appUrl,
      { threadId: '<inc-inc-133@notify.example.test>', startsThread: false },
    )!;
    expect(ack.text).toContain('13 min so far');
  });

  it('DOWN AGAIN: mentions the owner while nobody acked, counts the downtime before the drop', () => {
    const m = renderChat(
      row('down_again', {
        startedAt: '2026-09-20T20:24:00Z',
        backSince: '2026-09-20T20:19:00Z',
        fromState: 'monitoring',
        nowFlapping: true,
        flapping: true,
      }),
      voca,
      appUrl,
      now,
    )!;
    expect(m.text).toBe('<users/PLOY> DOWN AGAIN · VOCA (Tier 2) · same incident INC-0133');
    expect(m.cardsV2[0]!.card.header.title).toBe('DOWN AGAIN · VOCA · was back for 5 min (03:19–03:24)');
    expect(JSON.stringify(m.cardsV2)).toContain('Down 7 min so far in this incident.');
  });

  it('PROBLEM AGAIN mentions whoever acknowledged, not the owner', () => {
    const acked = {
      ...voca,
      acked_at: '2026-09-20T20:14:00Z',
      acker: { display_name: 'Nok', google_chat_user_id: 'NOK' },
    };
    const m = renderChat(
      row('problem_again', { summary: 'slow, p50 5.4 s', startedAt: '2026-09-20T20:24:00Z' }),
      acked,
      appUrl,
      now,
    )!;
    expect(m.text).toMatch(/^<users\/NOK> PROBLEM AGAIN · VOCA \(Tier 2\) · slow again, p50 5\.4 s/);
  });

  it('the flapping summary lists the closed drops; its email goes in the thread', () => {
    const closed = {
      ...voca,
      incident_events: [
        ...voca.incident_events!,
        { type: 'recovered', payload: {}, at: '2026-09-20T20:35:00Z' },
      ],
    };
    const m = renderChat(row('flap_summary'), closed, appUrl, now)!;
    expect(m.text).toBe(
      '<users/PLOY> RECOVERED · VOCA · stable 15 min · flapped ×2, down 18 min in total · add a root cause',
    );
    const to = { id: 'u-ploy', email: 'ploy@example.test', display_name: 'Ploy' };
    const e = renderEmail(row('flap_summary'), closed, to, appUrl, {
      threadId: '<inc-inc-133@x.test>',
      startsThread: false,
    })!;
    expect(e.text).toMatch(/^RECOVERED — VOCA is stable again/);
  });

  it('a flapping incident raised from PROBLEM (D-021): two flips, DOWN minutes only (D-033)', () => {
    // slow from 03:00, an outage from 03:10 (escalated while the PROBLEM drop was open), back 03:15,
    // down again 03:20–03:25 — uptime counts 10 DOWN min (S06), and so do the messages now
    const raised: IncidentFacts = {
      ...voca,
      severity: 'down',
      started_at: '2026-09-20T20:00:00Z',
      incident_events: [
        { type: 'detected', payload: {}, at: '2026-09-20T20:00:30Z' },
        {
          type: 'escalated_to_down',
          payload: { downStartedAt: '2026-09-20T20:10:00Z' },
          at: '2026-09-20T20:10:40Z',
        },
        { type: 'recovered', payload: {}, at: '2026-09-20T20:15:00Z' },
        {
          type: 'relapsed',
          payload: { startedAt: '2026-09-20T20:20:00Z', severity: 'down' },
          at: '2026-09-20T20:20:30Z',
        },
        { type: 'recovered', payload: {}, at: '2026-09-20T20:25:00Z' },
      ],
    };
    const m = renderChat(row('flap_summary'), raised, appUrl, now)!;
    expect(m.text).toContain('flapped ×2, down 10 min in total');
    expect(m.cardsV2[0]!.card.header.title).toBe(
      'RECOVERED · VOCA stable since 03:25 · flapped ×2 (03:00–03:25)',
    );
    expect(JSON.stringify(m.cardsV2)).toContain(
      'Down 2 times: 03:10–03:15 · 03:20–03:25 — 10 min down in total.',
    );
    const e = renderEmail(row('flap_summary'), raised, ploy, appUrl, {
      threadId: '<t@x>',
      startsThread: false,
    })!;
    expect(e.text).toContain('Down 2 times: 03:10–03:15 · 03:20–03:25');
    expect(e.text).toContain('Down in total: 10 min');
  });

  it('one DOWN drop among PROBLEM ones reads "Down once" (D-033)', () => {
    const mixed: IncidentFacts = {
      ...voca,
      severity: 'down',
      started_at: '2026-09-20T20:00:00Z',
      incident_events: [
        { type: 'detected', payload: {}, at: '2026-09-20T20:00:30Z' },
        { type: 'recovered', payload: {}, at: '2026-09-20T20:05:00Z' },
        {
          type: 'relapsed',
          payload: { startedAt: '2026-09-20T20:10:00Z', severity: 'problem', trigger: 'key_page' },
          at: '2026-09-20T20:10:30Z',
        },
        { type: 'recovered', payload: {}, at: '2026-09-20T20:12:00Z' },
      ],
    };
    const m = renderChat(row('flap_summary'), mixed, appUrl, now)!;
    expect(m.text).toContain('flapped ×2, down 5 min in total');
    expect(JSON.stringify(m.cardsV2)).toContain('Down once: 03:00–03:05 — 5 min down in total.');
  });

  it('RECOVERED of a key page’s PROBLEM on a DOWN incident words it as a problem (S06 review N3)', () => {
    const keyPage: IncidentFacts = {
      ...voca,
      severity: 'down',
      incident_events: [
        { type: 'detected', payload: {}, at: '2026-09-20T20:12:40Z' },
        { type: 'recovered', payload: {}, at: '2026-09-20T20:19:00Z' },
        {
          type: 'relapsed',
          payload: { startedAt: '2026-09-20T20:19:00Z', severity: 'problem', trigger: 'key_page' },
          at: '2026-09-20T20:19:00Z',
        },
        { type: 'recovered', payload: {}, at: '2026-09-20T20:30:00Z' },
      ],
    };
    const m = renderChat(
      row('recovered', { okLocations: 3, recoveredAt: '2026-09-20T20:30:00Z' }),
      keyPage,
      appUrl,
      now,
    )!;
    expect(m.cardsV2[0]!.card.header.title).toBe(
      'RECOVERED · VOCA back to normal · problem for 11 min (03:19–03:30)',
    );
    const down = renderChat(
      row('recovered', { okLocations: 3, recoveredAt: '2026-09-20T20:19:00Z' }),
      keyPage,
      appUrl,
      now,
    )!;
    expect(down.cardsV2[0]!.card.header.title).toBe('RECOVERED · VOCA is back · down 7 min (03:12–03:19)');
  });

  it('DOWN AGAIN counts the DOWN drops only; PROBLEM AGAIN every drop', () => {
    const mixed: IncidentFacts = {
      ...voca,
      incident_events: [
        { type: 'detected', payload: {}, at: '2026-09-20T20:12:40Z' },
        { type: 'recovered', payload: {}, at: '2026-09-20T20:19:00Z' },
        {
          type: 'relapsed',
          payload: { startedAt: '2026-09-20T20:20:00Z', severity: 'problem', trigger: 'slow' },
          at: '2026-09-20T20:20:30Z',
        },
        { type: 'recovered', payload: {}, at: '2026-09-20T20:30:00Z' },
      ],
    };
    const ctx = {
      startedAt: '2026-09-20T20:40:00Z',
      backSince: '2026-09-20T20:30:00Z',
      fromState: 'monitoring',
    };
    expect(JSON.stringify(renderChat(row('down_again', ctx), mixed, appUrl, now)!.cardsV2)).toContain(
      'Down 7 min so far',
    );
  });

  it('RECOVERED renders from its own recovery even after a relapse cleared the incident’s', () => {
    const m = renderChat(
      row('recovered', { okLocations: 3, recoveredAt: '2026-09-20T20:19:00Z' }),
      voca,
      appUrl,
      now,
    )!;
    expect(m.text).toContain('down 7 min');
  });

  it('an auto-resolved PROBLEM: RECOVERED with no mention, counted from when it was flagged', () => {
    const fuji: IncidentFacts = {
      ...incident,
      state: 'resolved',
      trigger: 'key_page',
      detected_at: '2026-09-25T03:02:00Z',
      incident_events: [
        {
          type: 'detected',
          payload: {
            keyPage: { path: '/contact', failure: 'HTTP 500', cause: '/contact → HTTP 500 (BKK, SIN, TYO)' },
          },
          at: '2026-09-25T03:02:00Z',
        },
      ],
    };
    const m = renderChat(
      row('recovered', { okLocations: 3, recoveredAt: '2026-09-25T03:05:00Z', autoResolved: true }),
      fuji,
      appUrl,
      now,
    )!;
    expect(m.text).toBe(
      'RECOVERED · Fuji Links · /contact back 3 min after it was flagged, before anyone acknowledged · resolved automatically',
    );
  });
});

describe('render — NOTE and RESOLVED (S07, D-033)', () => {
  const orca: IncidentFacts = {
    ...incident,
    id: 'inc-139',
    number: 139,
    state: 'resolved',
    severity: 'down',
    trigger: 'hard_fail',
    started_at: '2026-09-24T15:14:00Z',
    recovered_at: '2026-09-24T15:22:00Z',
    incident_events: [
      { type: 'detected', payload: {}, at: '2026-09-24T15:14:30Z' },
      { type: 'recovered', payload: {}, at: '2026-09-24T15:22:00Z' },
    ],
    sites: { ...incident.sites, name: 'ORCA Thailand' },
  };
  const resolvedCtx = {
    resolvedBy: 'Tao',
    resolvedById: 'u-tao',
    resolvedAt: '2026-09-25T03:08:00Z',
    category: 'hosting',
    what: 'Host rebooted the app server without notice',
    fix: null,
  };
  it('NOTE: the board line, nobody mentioned', () => {
    const m = renderChat(row('note', { text: 'restarting the app server', by: 'Arm' }), orca, appUrl, now)!;
    expect(m).toEqual({ text: 'NOTE · ORCA Thailand · Arm: restarting the app server', cardsV2: [] });
  });
  it('RESOLVED: the board line and the root cause in words', () => {
    const m = renderChat(row('resolved', resolvedCtx), orca, appUrl, now)!;
    expect(m.text).toBe('RESOLVED · ORCA Thailand · by Tao 10:08');
    expect(JSON.stringify(m.cardsV2)).toContain('Hosting / server');
    expect(JSON.stringify(m.cardsV2)).toContain('8 min (22:14–22:22)');
  });
  it('the RESOLVED email: the owner as owner, anyone else as emailed', () => {
    const thread = { threadId: '<t@x>', startsThread: false };
    const owner = renderEmail(
      { ...row('resolved', resolvedCtx), channel: 'email' },
      orca,
      ploy,
      appUrl,
      thread,
    )!;
    expect(owner.text).toContain('You got this because you own ORCA Thailand.');
    const other = renderEmail(
      { ...row('resolved', resolvedCtx), channel: 'email', user_id: 'u-nok' },
      orca,
      { ...ploy, id: 'u-nok' },
      appUrl,
      thread,
    )!;
    expect(other.text).toContain('You got this because you were emailed about this incident.');
    expect(other.text).toContain('Root cause: Hosting / server');
  });
});

describe('render — a DOWN email that goes after an ack (D-047)', () => {
  const down: IncidentFacts = {
    ...incident,
    state: 'acknowledged',
    severity: 'down',
    trigger: 'hard_fail',
    acked_at: '2026-09-25T02:53:00Z',
    acker: { id: 'u-ploy', display_name: 'Ploy' },
    recovered_at: null,
  } as IncidentFacts;
  const thread = { threadId: '<inc-inc-141@notify.example.test>', startsThread: true };

  it('acked inside its 5-min grace: says who has it, never "while it was a problem"', () => {
    const e = renderEmail(row('down', { cause: 'Timeout > 30 s (BKK, TYO)' }), down, ploy, appUrl, thread)!;
    expect(e.text).not.toContain('while it was a problem');
    expect(e.text).not.toContain('Nobody has acknowledged');
    expect(e.text).toContain('Ploy acknowledged it at 09:53.');
  });

  it('a PROBLEM raised to DOWN keeps its acknowledgement (D-021)', () => {
    const e = renderEmail(
      row('down', { cause: 'HTTP 500 (SIN, TYO)', escalated: true }),
      down,
      ploy,
      appUrl,
      thread,
    )!;
    expect(e.text).toContain('Ploy acknowledged it while it was a problem; it is now down.');
  });
});
