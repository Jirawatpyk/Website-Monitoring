import { describe, expect, it } from 'vitest';
import type { ReportIncident, ReportSiteUptime, WeeklyFacts } from './reports';
import { weeklyEmail, weeklyEmailModel } from './weekly-email';

// WeeklyEmail board sample (busy week Mon 9 – Sun 15 Nov) as test data only — never product code.
const bkk = (s: string) => new Date(`${s}+07:00`);
const PLOY = { name: 'Ploy', chatUserId: null };
const ARM = { name: 'Arm', chatUserId: null };

const incident = (over: Partial<ReportIncident>): ReportIncident => ({
  site: 'MuvMi',
  number: 140,
  severity: 'down',
  startedAt: bkk('2026-11-12T09:48:00'),
  startedBefore: false,
  minutes: 43,
  drops: 1,
  failing: false,
  cause: 'Hard fail — timeout at BKK and TYO, 504 at SIN',
  outsideHours: false,
  state: 'needs_root_cause',
  owner: ARM,
  level: 0,
  acked: null,
  clientUpdate: null,
  rootCause: null,
  ...over,
});

const site = (s: string, tier: number, target: number, downMinutes: number): ReportSiteUptime => ({
  site: s,
  tier,
  target,
  uptime: 1 - downMinutes / 43_200,
  downMinutes,
  windowMinutes: 43_200,
  since: null,
  week: 1,
});

const busy = (over: Partial<WeeklyFacts> = {}): WeeklyFacts => ({
  at: bkk('2026-11-16T09:00:00'),
  weekStart: bkk('2026-11-09T00:00:00'),
  weekEnd: bkk('2026-11-15T23:59:00'),
  sitesTotal: 17,
  sitesWithoutDowntime: 14,
  uptime: 0.99953,
  incidents: [
    incident({
      site: 'MuvMi',
      level: 1,
      acked: { by: 'Arm', at: bkk('2026-11-12T10:07:00') },
      clientUpdate: { by: 'Bua', at: bkk('2026-11-12T10:12:00') },
    }),
    incident({
      site: 'ENEOS Industrial',
      startedAt: bkk('2026-11-11T14:20:00'),
      minutes: 12,
      cause: 'Hard fail',
      state: 'acknowledged',
      acked: { by: 'Ploy', at: bkk('2026-11-11T14:25:00') },
      stillProblem: 'TLS chain misconfigured',
    }),
    incident({
      site: 'Fuji Links',
      severity: 'problem',
      startedAt: bkk('2026-11-10T16:00:00'),
      minutes: 22,
      cause: 'Slow, p50 5.8 s',
      state: 'resolved',
      acked: { by: 'Ploy', at: bkk('2026-11-10T16:06:00') },
      rootCause: 'Image CDN slow',
    }),
  ],
  sites: [
    site('Bangkok Airways – Taiwan', 1, 0.9995, 0),
    site('MuvMi', 1, 0.999, 186),
    site('realme.link', 1, 0.9995, 0),
    site('Fuji Links', 2, 0.999, 0),
  ],
  needsSomeone: [
    { kind: 'root_cause', text: 'MuvMi DOWN Thu 12 Nov (43 min) — no root cause yet', who: [ARM] },
    {
      kind: 'swap',
      text: 'On-call swap 23–30 Nov — Arm asked to swap with Ploy, not accepted yet',
      who: [PLOY],
    },
  ],
  mtta: [
    { tier: 1, seconds: 12 * 60, targetMin: 15 },
    { tier: 2, seconds: null, targetMin: 15 },
  ],
  planned: [
    {
      kind: 'mute',
      site: 'DxT Games',
      start: bkk('2026-11-13T13:00:00'),
      end: bkk('2026-11-13T15:00:00'),
      endedEarly: false,
      reason: 'client changing DNS',
      by: 'Arm',
    },
  ],
  comingUp: [],
  onCall: {
    thisWeek: { name: 'Nok', week: { start: bkk('2026-11-16T09:00:00'), end: bkk('2026-11-23T09:00:00') } },
    next: null,
  },
  monitor: { roundsShare: 1, engineGaps: [], probeGaps: [], admins: ['Tao', 'Mint'] },
  appUrl: 'https://monitor.example',
  ...over,
});

describe('weekly email (WeeklyEmail board, §36)', () => {
  it('starts with the period and four neutral tiles that count the week (§36.2)', () => {
    const m = weeklyEmailModel(busy());
    expect(m.subject).toBe('DxT Monitor · Weekly summary · 9–15 Nov');
    expect(m.title).toBe('Website week · Mon 9 – Sun 15 Nov');
    expect(m.tiles).toEqual([
      { n: '99.95%', k: 'Uptime, all sites', cap: 'this week · maintenance excluded' },
      { n: '14/17', k: 'No downtime', cap: 'sites this week' },
      { n: '2', k: 'DOWN incidents', cap: 'this week · 1 still open, now PROBLEM' },
      { n: '1', k: 'PROBLEM incidents', cap: 'this week · all recovered' },
    ]);
    expect(m.preheader).toBe(
      'Uptime 99.95% · 14/17 sites had no downtime · 2 DOWN, 1 PROBLEM this week · 1 still open · 2 things need someone',
    );
  });

  it('puts the 30-day figure under the tiles, naming who is below (§36.3)', () => {
    expect(weeklyEmailModel(busy()).month).toBe(
      'Last 30 days: 3/4 sites on their uptime target — MuvMi is below.',
    );
  });

  it('lists incidents open first, then newest first, each with its badge and two lines (§36.5–7)', () => {
    const m = weeklyEmailModel(busy());
    expect(m.incidentsTitle).toBe('INCIDENTS · 3 · 1 STILL OPEN');
    expect(m.incidents).toEqual([
      {
        badge: 'problem',
        site: 'ENEOS Industrial',
        line1: 'Wed 11 Nov 14:20 · 12 min down · still open',
        line2:
          'Home page back, still failing: TLS chain misconfigured · acked by Ploy 14:25 · no root cause yet',
      },
      {
        badge: 'wasDown',
        site: 'MuvMi',
        line1: 'Thu 12 Nov 09:48 · 43 min',
        line2:
          'Hard fail — timeout at BKK and TYO, 504 at SIN · reached L1, acked by Arm 10:07 · client updated by Bua 10:12 · no root cause yet',
      },
      {
        badge: 'wasProblem',
        site: 'Fuji Links',
        line1: 'Tue 10 Nov 16:00 · 22 min',
        line2: 'Slow, p50 5.8 s · acked by Ploy 16:06 · root cause: image CDN slow',
      },
    ]);
  });

  it('a site below its target gets its own row; the rest fold into one line (§36.8, D-059 30 days)', () => {
    const u = weeklyEmailModel(busy()).uptime!;
    expect(u.below).toEqual([
      // D-059: 30 days, this week beside it — under the weekly tiles a bare figure reads as the week's.
      {
        site: 'MuvMi',
        figure: '30 d 99.56%',
        rest: 'target 99.90% · this week 100.00% · 3 h 6 min down · 43 min allowed',
      },
    ]);
    expect(u.onTarget).toEqual({
      count: '3 on target',
      names: '— Bangkok Airways – Taiwan, realme.link, Fuji Links',
    });
    const quiet = weeklyEmailModel(
      busy({ sites: [site('Fuji Links', 2, 0.999, 0), site('VOCA', 2, 0.999, 0)] }),
    );
    expect(quiet.uptime!.onTarget).toEqual({ count: 'All 2 on target', names: null });
  });

  it('leaves an empty section out (Quiet week)', () => {
    const m = weeklyEmailModel(
      busy({ incidents: [], needsSomeone: [], planned: [], sitesWithoutDowntime: 17, uptime: 1 }),
    );
    expect(m.incidentsTitle).toBeNull();
    expect(m.needs).toEqual([]);
    expect(m.tiles[2]).toEqual({ n: '0', k: 'DOWN incidents', cap: 'this week' });
    expect(m.preheader).toBe('Uptime 100.00% · 17/17 sites had no downtime · no incidents this week');
    const mail = weeklyEmail(busy({ incidents: [], needsSomeone: [], planned: [] }));
    expect(mail.html).not.toContain('NEEDS SOMEONE');
    expect(mail.html).not.toContain('INCIDENTS ·');
    expect(mail.html).not.toContain('PLANNED &amp; QUIET');
  });

  it('MTTA: the tier figure against its target, "— (no DOWN in hours)" for none', () => {
    expect(weeklyEmailModel(busy()).mtta).toEqual([
      { k: 'Tier 1', v: '12 min · target 15', tone: 'positive' },
      { k: 'Tier 2', v: '— (no DOWN in hours)', tone: 'neutral' },
    ]);
  });

  it('renders email-safe HTML with a dark set, a phone layout and a plain-text part in the same order', () => {
    const mail = weeklyEmail(busy());
    expect(mail.subject).toBe('DxT Monitor · Weekly summary · 9–15 Nov');
    expect(mail.html).toContain('@media (prefers-color-scheme:dark)');
    expect(mail.html).toContain('@media (max-width:480px)');
    expect(mail.html).toContain('class="b-problem"');
    expect(mail.html).toContain('>PROBLEM</span>');
    expect(mail.html).toContain('>Was down</span>');
    expect(mail.html).toContain('>Muted</span>');
    expect(mail.html).not.toContain('var(--');
    const order = [
      'WEEKLY SUMMARY',
      'NEEDS SOMEONE',
      'INCIDENTS',
      'UPTIME BY SITE',
      'MTTA',
      'PLANNED & QUIET',
      'COMING UP',
      'THE MONITOR ITSELF',
    ];
    const at = order.map((h) => mail.text.indexOf(h));
    expect(at.every((n) => n >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(mail.text).toContain('Open incidents: https://monitor.example/incidents');
    expect(mail.text).toContain('You got this because you get the weekly summary as the CEO.');
  });

  it('COMING UP words the on-call week as the board; the button sits beside the DxT mark', () => {
    const m = weeklyEmailModel(
      busy({
        onCall: {
          thisWeek: {
            name: 'Nok',
            week: { start: bkk('2026-11-16T09:00:00'), end: bkk('2026-11-23T09:00:00') },
          },
          next: {
            name: 'Arm',
            week: { start: bkk('2026-11-23T09:00:00'), end: bkk('2026-11-30T09:00:00') },
            swap: null,
          },
        },
      }),
    );
    expect(m.coming[0]).toBe('On call (Tier 1 nights and weekends): Nok, Mon 16 → Mon 23 Nov. Next: Arm.');
    expect(weeklyEmail(busy()).html).toMatch(/>DxT <span/);
  });

  it('escapes what people typed', () => {
    const evil = weeklyEmail(busy({ planned: [{ ...busy().planned[0]!, reason: '<img src=x> & "y"' }] }));
    expect(evil.html).toContain('&lt;img src=x&gt; &amp; &quot;y&quot;');
    expect(evil.html).not.toContain('<img');
  });
});
