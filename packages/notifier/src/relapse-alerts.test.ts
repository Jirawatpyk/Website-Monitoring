import { describe, expect, it } from 'vitest';
import {
  buildAgainEmail,
  buildAutoResolvedEmail,
  buildFlapSummaryEmail,
  incidentThreadId,
  type EmailBaseInput,
} from './email-alerts';
import {
  buildAgainAlert,
  buildAutoResolvedAlert,
  buildFlapSummaryAlert,
  type AgainAlertInput,
} from './relapse-alerts';

// ChatAlert "Fails again while the incident is open" and EmailAlert "VOCA · flapping" /
// "Fuji Links · auto-resolved" (spec §19.3–19.7, D-024). Bangkok times (UTC+7) on the boards.
const bkk = (hhmm: string, day = '21') => new Date(`2026-09-${day}T${hhmm}:00+07:00`);
const ploy = { name: 'Ploy', chatUserId: 'PLOY' };
const nok = { name: 'Nok', chatUserId: 'NOK' };
const title = (m: { cardsV2: { card: { header: { title: string } } }[] }) => m.cardsV2[0]!.card.header.title;
const body = (m: { cardsV2: { card: { sections: { widgets: unknown[] }[] } }[] }) =>
  (m.cardsV2[0]!.card.sections[0]!.widgets[0] as { textParagraph: { text: string } }).textParagraph.text;

const voca = (over: Partial<AgainAlertInput>): AgainAlertInput => ({
  incidentId: 'inc-133',
  incidentNumber: 133,
  site: 'VOCA',
  tier: 2,
  severity: 'down',
  trigger: 'hard_fail',
  mention: ploy,
  ackedBy: null,
  fromState: 'monitoring',
  droppedAt: bkk('03:24'),
  backSince: bkk('03:19'),
  minutesSoFar: 7,
  nowFlapping: true,
  flapping: true,
  ...over,
});

describe('DOWN AGAIN (ChatAlert VOCA)', () => {
  it('03:24: joins INC-0133, mentions whoever acts now, says it is now flapping', () => {
    const m = buildAgainAlert(voca({}));
    // "outside response hours · timers paused until 09:00" comes with S08 (D-013).
    expect(m.text).toBe('<users/PLOY> DOWN AGAIN · VOCA (Tier 2) · same incident INC-0133');
    expect(title(m)).toBe('DOWN AGAIN · VOCA · was back for 5 min (03:19–03:24)');
    expect(body(m)).toBe(
      'Joined INC-0133 — no new incident (the incident was still open, in Monitoring). Down 7 min so far in this incident. ' +
        'Now flapping (3 changes in 30 min): recovery replies are held until VOCA stays OK for 15 min.',
    );
  });

  it('03:38, still flapping: the later-drop template', () => {
    const m = buildAgainAlert(
      voca({ droppedAt: bkk('03:38'), backSince: bkk('03:35'), minutesSoFar: 18, nowFlapping: false }),
    );
    expect(m.text).toBe('<users/PLOY> DOWN AGAIN · VOCA (Tier 2) · same incident INC-0133 · still flapping');
    expect(title(m)).toBe('DOWN AGAIN · VOCA · was back for 3 min (03:35–03:38)');
    expect(body(m)).toBe(
      'Still flapping — recovery replies are still held until VOCA stays OK for 15 min. Down 18 min so far in this incident.',
    );
  });

  it('not flapping: no flapping sentence; Needs root cause named', () => {
    const m = buildAgainAlert(voca({ nowFlapping: false, flapping: false, fromState: 'needs_root_cause' }));
    expect(body(m)).toBe(
      'Joined INC-0133 — no new incident (the incident was still open, in Needs root cause). Down 7 min so far in this incident.',
    );
  });
});

describe('PROBLEM AGAIN (ChatAlert INC-0150, INC-0152)', () => {
  it('INC-0150 WeCare Studio: slow again after 6 min OK, only Nok (who acknowledged) mentioned', () => {
    const m = buildAgainAlert(
      voca({
        incidentNumber: 150,
        site: 'WeCare Studio',
        severity: 'problem',
        trigger: 'slow',
        mention: nok,
        ackedBy: 'Nok',
        droppedAt: bkk('10:16', '25'),
        backSince: bkk('10:10', '25'),
        summary: 'slow, p50 5.4 s',
        nowFlapping: false,
        flapping: false,
      }),
    );
    expect(m.text).toBe(
      '<users/NOK> PROBLEM AGAIN · WeCare Studio (Tier 2) · slow again, p50 5.4 s · same incident INC-0150',
    );
    expect(title(m)).toBe('PROBLEM AGAIN · WeCare Studio · slow again after 6 min OK');
    expect(body(m)).toBe(
      'Joined INC-0150 while it was still open (Monitoring). Nok acknowledged earlier, so only Nok is mentioned.',
    );
  });

  it.each([
    // S09c: several found words are one head; the crawler view's bracket stays last.
    ['“a”, “b” found on the page', '“a”, “b” found on the page again', '“a”, “b” found on the page'],
    [
      '“บาคาร่า” found on the page (as Googlebot)',
      '“บาคาร่า” found on the page again (as Googlebot)',
      '“บาคาร่า” found on the page',
    ],
    [
      'redirects to casino.example.net (from Google search)',
      'redirects to casino.example.net again (from Google search)',
      'redirects to casino.example.net',
    ],
  ])('PROBLEM AGAIN reads "%s" as "%s"', (summary, line, head) => {
    const m = buildAgainAlert(
      voca({ severity: 'problem', trigger: 'keyword', summary, nowFlapping: false, flapping: false }),
    );
    expect(m.text).toContain(` · ${line} · same incident`);
    expect(title(m)).toContain(`PROBLEM AGAIN · VOCA · ${head} again after`);
  });

  it('INC-0152 VOCA: /booking still failing after the home page came back (same round as RECOVERED)', () => {
    const m = buildAgainAlert(
      voca({
        incidentNumber: 152,
        severity: 'problem',
        trigger: 'key_page',
        backSince: null,
        nowFlapping: false,
        flapping: false,
        homeBack: { path: '/booking', failure: 'HTTP 404', cause: '/booking → HTTP 404 (BKK, SIN, TYO)' },
      }),
    );
    expect(m.text).toBe(
      '<users/PLOY> PROBLEM AGAIN · VOCA (Tier 2) · /booking still failing (HTTP 404) after the home page came back · same incident INC-0152',
    );
    expect(title(m)).toBe('PROBLEM AGAIN · VOCA · /booking still failing after the home page came back');
    expect(body(m)).toBe(
      'Home page OK again (RECOVERED posted in the same round). /booking → HTTP 404 (BKK, SIN, TYO) — the same incident continues as a PROBLEM (Key page).',
    );
  });

  it('a key page failing again after a full recovery: the summary carries the page', () => {
    const m = buildAgainAlert(
      voca({
        severity: 'problem',
        trigger: 'key_page',
        summary: 'key page /contact, HTTP 500',
        droppedAt: bkk('10:16', '25'),
        backSince: bkk('10:10', '25'),
        nowFlapping: false,
        flapping: false,
      }),
    );
    expect(m.text).toBe(
      '<users/PLOY> PROBLEM AGAIN · VOCA (Tier 2) · key page /contact again, HTTP 500 · same incident INC-0133',
    );
    expect(title(m)).toBe('PROBLEM AGAIN · VOCA · key page /contact again after 6 min OK');
  });

  it('a site name can’t inject a mention or markup', () => {
    const m = buildAgainAlert(voca({ site: '<users/all> VOCA' }));
    expect(m.text).not.toContain('<users/all>');
  });
});

describe('the flapping summary (ChatAlert VOCA 04:19, EmailAlert "VOCA · flapping")', () => {
  const drops = [
    ['03:12', '03:19'],
    ['03:24', '03:35'],
    ['03:38', '03:52'],
    ['03:55', '04:04'],
  ].map(([a, b]) => ({ start: bkk(a!), end: bkk(b!) }));

  it('Chat: stable 15 min · flapped ×4, down 41 min in total, the owner mentioned', () => {
    const m = buildFlapSummaryAlert({
      incidentId: 'inc-133',
      site: 'VOCA',
      severity: 'down',
      owner: ploy,
      drops,
    });
    expect(m.text).toBe(
      '<users/PLOY> RECOVERED · VOCA · stable 15 min · flapped ×4, down 41 min in total · add a root cause',
    );
    expect(title(m)).toBe('RECOVERED · VOCA stable since 04:04 · flapped ×4 (03:12–04:04)');
    expect(body(m)).toBe(
      'Down 4 times: 03:12–03:19 · 03:24–03:35 · 03:38–03:52 · 03:55–04:04 — 41 min down in total. Needs a root cause before it can be resolved.',
    );
  });

  it('email: one summary to the owner in the incident thread', () => {
    const base: EmailBaseInput = {
      incidentId: 'inc-133',
      incidentNumber: 133,
      site: 'VOCA',
      tier: 2,
      recipientId: 'u-ploy',
      reason: 'owner',
      incidentUrl: 'https://monitor.example.test/incidents/inc-133',
      threadId: incidentThreadId('inc-133', 'DxT Monitor <alerts@notify.example.test>'),
      startsThread: false,
    };
    const e = buildFlapSummaryEmail({ ...base, severity: 'down', drops, owner: 'Ploy', ack: null });
    expect(e.subject).toBe('VOCA · Tier 2 · INC-0133');
    expect(e.headers['In-Reply-To']).toBe('<inc-inc-133@notify.example.test>');
    expect(e.html).toContain(
      'RECOVERED — VOCA stable since 04:04 · flapped ×4 · 41 min down in total · root cause needed',
    );
    expect(e.text).toMatch(/^RECOVERED — VOCA is stable again/);
    expect(e.text).toContain('VOCA is stable again');
    expect(e.text).toContain(
      'VOCA flapped 4 times and has been stable for 15 min. Needs a root cause before it can be resolved.',
    );
    expect(e.text).toContain('03:12–03:19 · 03:24–03:35 · 03:38–03:52 · 03:55–04:04');
    expect(e.text).toContain('04:04 — OK for 15 min');
    expect(e.text).toContain('Root cause (Ploy) — needed before it can be resolved');
    expect(e.text).toContain('You got this because you own VOCA.');
  });
});

describe('RECOVERED for an auto-resolved PROBLEM (ChatAlert / EmailAlert INC-0151)', () => {
  const keyPage = { path: '/contact', failure: 'HTTP 500', cause: '/contact → HTTP 500 (BKK, SIN, TYO)' };

  it('Chat: no @mention, cleared 3 min after it was flagged, resolved automatically', () => {
    const m = buildAutoResolvedAlert({
      incidentId: 'inc-151',
      site: 'Fuji Links',
      flaggedAt: bkk('10:02', '25'),
      recoveredAt: bkk('10:05', '25'),
      okLocations: 3,
      problem: { trigger: 'key_page' },
      keyPage,
    });
    expect(m.text).toBe(
      'RECOVERED · Fuji Links · /contact back 3 min after it was flagged, before anyone acknowledged · resolved automatically',
    );
    expect(title(m)).toBe(
      'RECOVERED · Fuji Links /contact back to normal · cleared 3 min after it was flagged',
    );
    expect(body(m)).toBe(
      '/contact loads again from 3 locations (it returned HTTP 500 while the home page stayed OK). Nobody acknowledged it — ' +
        'a PROBLEM that clears within 5 min of being flagged, with no acknowledgement, auto-resolves on the first OK round. ' +
        'Resolved automatically — no root cause needed.',
    );
  });

  it('Chat: a home-page PROBLEM (slow) says what is back', () => {
    const m = buildAutoResolvedAlert({
      incidentId: 'inc-9',
      site: 'Fuji Links',
      flaggedAt: bkk('10:02', '25'),
      recoveredAt: bkk('10:04', '25'),
      okLocations: 3,
      problem: { trigger: 'slow', slowLimitMs: 5_000 },
    });
    expect(m.text).toBe(
      'RECOVERED · Fuji Links · back 2 min after it was flagged, before anyone acknowledged · resolved automatically',
    );
    expect(body(m)).toMatch(/^Response time back under 5 s from 3 locations\./);
  });

  it('email: in the PROBLEM thread, nothing to do', () => {
    const e = buildAutoResolvedEmail({
      incidentId: 'inc-151',
      incidentNumber: 151,
      site: 'Fuji Links',
      tier: 2,
      recipientId: 'u-ploy',
      reason: 'owner',
      incidentUrl: 'https://monitor.example.test/incidents/inc-151',
      threadId: '<inc-inc-151@notify.example.test>',
      startsThread: false,
      trigger: 'key_page',
      flaggedAt: bkk('10:02', '25'),
      recoveredAt: bkk('10:05', '25'),
      cause: 'Home OK · /contact → HTTP 500 (BKK, SIN, TYO)',
      keyPage,
    });
    expect(e.subject).toBe('Fuji Links · Tier 2 · INC-0151');
    expect(e.html).toContain(
      'RECOVERED — Fuji Links /contact back to normal · cleared 3 min after it was flagged · resolved automatically',
    );
    expect(e.text).toContain('Fuji Links /contact is back');
    expect(e.text).toContain('Resolved automatically — no root cause needed. Nothing to do.');
    expect(e.text).toContain('Nobody — it cleared first');
  });
});

describe('DOWN AGAIN by email — only as the fallback when Chat failed (D-016, D-024)', () => {
  it('carries the Chat reply’s words in the incident thread', () => {
    const e = buildAgainEmail({
      incidentId: 'inc-133',
      incidentNumber: 133,
      site: 'VOCA',
      tier: 2,
      recipientId: 'u-tao',
      reason: 'fallback',
      incidentUrl: 'https://monitor.example.test/incidents/inc-133',
      threadId: '<inc-inc-133@notify.example.test>',
      startsThread: true,
      severity: 'down',
      title: 'DOWN AGAIN · VOCA · was back for 5 min (03:19–03:24)',
      body: 'Joined INC-0133 — no new incident.',
    });
    expect(e.html).toContain('DOWN AGAIN — VOCA · was back for 5 min (03:19–03:24) · same incident INC-0133');
    expect(e.text).toContain('VOCA is down again');
    expect(e.text).toContain('couldn’t be delivered, so this email is the alert');
  });
});
