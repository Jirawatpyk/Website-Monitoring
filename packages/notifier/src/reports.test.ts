import { describe, expect, it } from 'vitest';
import {
  digestModel,
  reportChat,
  weeklyEmail,
  weeklyModel,
  type DigestFacts,
  type MonitorFacts,
  type ReportIncident,
  type ReportSiteUptime,
  type WeeklyFacts,
} from './reports';

// Board sample (WeeklySummary) as test data only — never product code.
const bkk = (s: string) => new Date(`${s}+07:00`);
const TAO = { name: 'Tao', chatUserId: '111' };
const ARM = { name: 'Arm', chatUserId: '222' };
const NOK = { name: 'Nok', chatUserId: null };

const monitor = (over: Partial<MonitorFacts> = {}): MonitorFacts => ({
  roundsShare: 1,
  engineGaps: [],
  probeGaps: [],
  admins: ['Tao', 'Mint'],
  ...over,
});

const incident = (over: Partial<ReportIncident>): ReportIncident => ({
  site: 'ORCA Thailand',
  number: 140,
  severity: 'down',
  startedAt: bkk('2026-09-24T22:14:00'),
  startedBefore: false,
  minutes: 8,
  drops: 1,
  failing: false,
  cause: 'Hard fail',
  outsideHours: false,
  state: 'resolved',
  owner: TAO,
  level: 0,
  acked: null,
  clientUpdate: null,
  rootCause: null,
  ...over,
});

const digest = (over: Partial<DigestFacts> = {}): DigestFacts => ({
  at: bkk('2026-09-25T09:00:00'),
  sitesTotal: 17,
  sitesOk: 17,
  down: [],
  problem: [],
  browserChecked: ['Tubtong', 'Cando Asia'],
  muted: [{ site: 'DxT Games', until: bkk('2026-09-25T18:00:00'), reason: 'redeploying build' }],
  maintenance: [
    {
      kind: 'maintenance',
      site: 'WeCare Studio',
      start: bkk('2026-09-25T09:30:00'),
      end: bkk('2026-09-25T14:00:00'),
      endedEarly: false,
      reason: 'CMS upgrade',
      by: 'Nok',
    },
  ],
  yesterday: [
    incident({ outsideHours: true, state: 'needs_root_cause' }),
    incident({
      site: 'Tubtong',
      severity: 'problem',
      startedAt: bkk('2026-09-24T14:02:00'),
      minutes: 12,
      cause: 'Blocked, not verified',
      owner: ARM,
    }),
    incident({
      site: 'DxT AI',
      severity: 'problem',
      startedAt: bkk('2026-09-23T09:00:00'),
      startedBefore: true,
      minutes: 1440,
      cause: 'SSL expiring',
    }),
  ],
  monitor: monitor(),
  appUrl: 'https://monitor.example',
  ...over,
});

describe('daily digest (WeeklySummary "Daily digest")', () => {
  it('words the board sample', () => {
    const m = digestModel(digest());
    expect(m.textLine).toBe('Website status Fri 25 Sep 09:00 · 17/17 OK · 1 muted · follow-up: <users/111>');
    expect(m.title).toBe('Website status · Fri 25 Sep 09:00');
    expect(m.lines).toEqual(['Now: 17/17 OK · 1 muted (DxT Games)']);
    expect(m.sections[0]!.rows).toEqual([
      { label: 'OK · checked by browser', text: 'Tubtong, Cando Asia — bots blocked, page verified' },
      { label: 'Muted · until 18:00', text: 'DxT Games — redeploying build, still counted' },
      { label: 'Maintenance', text: 'WeCare Studio — Planned today 09:30–14:00 · CMS upgrade · not counted' },
    ]);
    expect(m.sections[1]!.title).toBe('Yesterday · Thu 24 Sep');
    expect(m.sections[1]!.rows.map((r) => r.text)).toEqual([
      'ORCA Thailand DOWN 8 min (22:14, hard fail, outside response hours) — needs a root cause, Tao',
      'Tubtong PROBLEM 12 min (14:02, blocked, not verified) — resolved',
      'DxT AI PROBLEM (SSL expiring, since Wed 23 Sep 09:00) — resolved',
      'Monitor ran 100.00% of rounds. A missing digest means the monitor itself needs checking.',
    ]);
  });

  it('shows what is true at 09:00: a running window, a DOWN and a PROBLEM now', () => {
    const m = digestModel(
      digest({
        sitesOk: 14,
        down: [
          { site: 'MuvMi', since: bkk('2026-09-25T08:48:00'), cause: 'Timeout ×2 · 504 ×1', number: 142 },
        ],
        problem: [{ site: 'Fuji Links', since: bkk('2026-09-24T20:00:00'), cause: 'Slow', number: 143 }],
        browserChecked: [],
        muted: [],
        maintenance: [
          {
            kind: 'maintenance',
            site: 'Bangkok Airways – China',
            start: bkk('2026-09-24T22:00:00'),
            end: bkk('2026-09-27T22:00:00'),
            endedEarly: false,
            reason: 'new hosting provider',
            by: null,
          },
        ],
        yesterday: [],
      }),
    );
    expect(m.textLine).toBe(
      'Website status Fri 25 Sep 09:00 · 14/17 OK · 1 DOWN · 1 PROBLEM · 1 in maintenance',
    );
    expect(m.lines).toEqual([
      'Now: 14/17 OK · 1 DOWN (MuvMi) · 1 PROBLEM (Fuji Links) · 1 in maintenance (Bangkok Airways – China)',
    ]);
    expect(m.sections[0]!.rows).toEqual([
      { label: 'DOWN', text: 'MuvMi — since 08:48 · Timeout ×2 · 504 ×1 · INC-0142' },
      { label: 'PROBLEM', text: 'Fuji Links — since Thu 24 Sep 20:00 · Slow · INC-0143' },
      {
        label: 'Maintenance',
        text: 'Bangkok Airways – China — Running now until Sun 27 Sep 22:00 · new hosting provider · not counted',
      },
    ]);
    // No incident yesterday: only the monitor line — never "none" (spec note).
    expect(m.sections[1]!.rows.map((r) => r.text)).toEqual([
      'Monitor ran 100.00% of rounds. A missing digest means the monitor itself needs checking.',
    ]);
  });

  it('leaves out the "now" rows when there are none, and the rounds share without a record', () => {
    const m = digestModel(
      digest({ browserChecked: [], muted: [], maintenance: [], monitor: monitor({ roundsShare: null }) }),
    );
    expect(m.sections).toHaveLength(1);
    expect(m.sections[0]!.rows.at(-1)!.text).toBe(
      'A missing digest means the monitor itself needs checking.',
    );
  });

  it('names an open incident by where it stands', () => {
    const m = digestModel(
      digest({
        yesterday: [
          incident({
            failing: true,
            state: 'acknowledged',
            acked: { by: 'Arm', at: bkk('2026-09-24T22:20:00') },
          }),
          incident({ site: 'VOCA', failing: true, state: 'unacked', severity: 'problem', cause: 'Slow' }),
          incident({ site: 'EQHO', state: 'monitoring', drops: 4 }),
        ],
      }),
    );
    expect(m.sections[1]!.rows.slice(0, 3).map((r) => r.text)).toEqual([
      'ORCA Thailand DOWN 8 min (22:14, hard fail) — still down, acknowledged by Arm',
      'VOCA PROBLEM 8 min (22:14, slow) — still a problem, not acknowledged',
      'EQHO DOWN 8 min (22:14, hard fail, flapped ×4) — recovered',
    ]);
    expect(m.textLine).not.toContain('follow-up');
  });
});

const site = (
  over: Partial<ReportSiteUptime> & Pick<ReportSiteUptime, 'site' | 'tier' | 'target'>,
): ReportSiteUptime => {
  const windowMinutes = over.windowMinutes ?? 30 * 1440;
  const downMinutes = over.downMinutes ?? 0;
  return {
    uptime: 1 - downMinutes / windowMinutes,
    downMinutes,
    windowMinutes,
    since: null,
    week: 1,
    ...over,
  };
};

const weekly = (over: Partial<WeeklyFacts> = {}): WeeklyFacts => ({
  at: bkk('2026-09-28T09:00:00'),
  weekStart: bkk('2026-09-21T00:00:00'),
  weekEnd: bkk('2026-09-27T23:59:00'),
  sitesTotal: 17,
  sitesWithoutDowntime: 14,
  uptime: 0.99953,
  incidents: [
    incident({
      site: 'MuvMi',
      startedAt: bkk('2026-09-25T09:48:00'),
      minutes: 43,
      cause: 'Timeout ×2 · 504 ×1',
      level: 1,
      acked: { by: 'Arm', at: bkk('2026-09-25T10:07:00') },
      clientUpdate: { by: 'Bua', at: bkk('2026-09-25T10:12:00') },
      state: 'needs_root_cause',
      owner: ARM,
    }),
    incident({
      site: 'VOCA',
      startedAt: bkk('2026-09-21T03:12:00'),
      minutes: 41,
      drops: 4,
      outsideHours: true,
    }),
    incident({
      site: 'Fuji Links',
      severity: 'problem',
      startedAt: bkk('2026-09-25T09:52:00'),
      minutes: 22,
      cause: 'Slow, p50 5.8 s',
      acked: { by: 'Ploy', at: bkk('2026-09-25T09:58:00') },
    }),
  ],
  // D-059: 30 days = 43,200 min. MuvMi (Tier 1, 99.95%: 21.6 min allowed) was down 43 min — below;
  // VOCA (Tier 2, 99.9%: 43.2 min) 41 min — on target; DxT AI watched since Wed 16 Sep only.
  sites: [
    site({ site: 'VOCA', tier: 2, target: 0.999, downMinutes: 41, week: 1 - 41 / 10_080 }),
    site({ site: 'MuvMi', tier: 1, target: 0.9995, downMinutes: 43, week: 1 - 43 / 10_080 }),
    site({ site: 'ORCA Thailand', tier: 2, target: 0.999, downMinutes: 0 }),
    site({
      site: 'DxT AI',
      tier: 3,
      target: 0.995,
      downMinutes: 0,
      windowMinutes: 12 * 1440,
      since: bkk('2026-09-16T10:00:00'),
    }),
  ],
  needsSomeone: [
    { kind: 'root_cause', text: 'MuvMi DOWN Fri 25 Sep (43 min) — no root cause yet', who: [ARM] },
    { kind: 'swap', text: 'On-call swap 5–12 Oct — Arm asked, not accepted yet', who: [NOK] },
    {
      kind: 'request',
      text: 'Maintenance request · Tubtong · Tue 29 Sep 01:00–03:00 — waiting for an Admin',
      who: [TAO, ARM],
    },
  ],
  mtta: [
    { tier: 1, seconds: 19 * 60, targetMin: 15 },
    { tier: 2, seconds: null, targetMin: 15 },
  ],
  planned: [
    {
      kind: 'maintenance',
      site: 'WeCare Studio',
      start: bkk('2026-09-25T09:30:00'),
      end: bkk('2026-09-25T14:00:00'),
      endedEarly: false,
      reason: 'CMS upgrade',
      by: 'Nok',
    },
    {
      kind: 'maintenance',
      site: 'Bangkok Airways – China',
      start: bkk('2026-09-26T22:00:00'),
      end: bkk('2026-09-29T22:00:00'),
      endedEarly: false,
      reason: 'new hosting provider',
      by: 'Arm',
    },
    {
      kind: 'mute',
      site: 'Cando Asia',
      start: bkk('2026-09-21T10:15:00'),
      end: bkk('2026-09-21T11:40:00'),
      endedEarly: true,
      reason: 'client changing DNS',
      by: 'Arm',
    },
  ],
  comingUp: [
    {
      kind: 'maintenance',
      site: 'Tubtong',
      start: bkk('2026-09-29T01:00:00'),
      end: bkk('2026-09-29T03:00:00'),
      endedEarly: false,
      reason: 'WordPress plugin updates',
      by: 'Ploy',
    },
  ],
  onCall: {
    thisWeek: { name: 'Nok', week: { start: bkk('2026-09-28T09:00:00'), end: bkk('2026-10-05T09:00:00') } },
    next: {
      name: 'Arm',
      week: { start: bkk('2026-10-05T09:00:00'), end: bkk('2026-10-12T09:00:00') },
      swap: 'swap with Nok asked, not accepted yet',
    },
  },
  monitor: monitor({
    roundsShare: 0.9974,
    engineGaps: [{ start: bkk('2026-09-26T02:17:00'), end: bkk('2026-09-26T02:43:00') }],
    probeGaps: [
      {
        location: 'SIN',
        start: bkk('2026-09-25T03:12:00'),
        end: bkk('2026-09-25T03:16:00'),
        others: ['BKK', 'TYO'],
      },
    ],
    admins: ['Tao'],
  }),
  appUrl: 'https://monitor.example',
  ...over,
});

describe('weekly summary (WeeklySummary "Weekly summary")', () => {
  it('words the header, the text line and its follow-ups once each', () => {
    const m = weeklyModel(weekly());
    expect(m.textLine).toBe(
      'Website week 21–27 Sep · 14/17 sites had no downtime · follow-ups: <users/222> <users/111>',
    );
    expect(m.title).toBe('Website week · Mon 21 – Sun 27 Sep');
    expect(m.lines).toEqual([
      'Week: 14/17 sites had no downtime',
      'Uptime all sites 99.95% · 3/4 sites on target (30 d) · 2 DOWN · 1 PROBLEM · maintenance excluded',
    ]);
  });

  // D-059 (the CEO, 9 Nov): every site against its tier's target, the furthest below first.
  it('judges each site against its tier target: below first, then the rest by tier', () => {
    const s = weeklyModel(weekly()).sections.find((x) => x.title?.startsWith('UPTIME BY SITE'))!;
    expect(s.title).toBe('UPTIME BY SITE · 1 BELOW TARGET');
    expect(s.rows).toEqual([
      {
        label: 'Below target',
        text: 'MuvMi · Tier 1 · 30 d 99.90% · target 99.95% · this week 99.57%',
        trail: '43 min down · 22 min allowed',
        warning: true,
      },
      {
        label: 'On target',
        text: 'VOCA · Tier 2 · 30 d 99.91% · target 99.90%',
        trail: '41 min down',
        warning: false,
      },
      {
        label: 'On target',
        text: 'ORCA Thailand · Tier 2 · 30 d 100.00% · target 99.90%',
        trail: '0 min down',
        warning: false,
      },
      {
        label: 'On target',
        text: 'DxT AI · Tier 3 · since Wed 16 Sep 100.00% · target 99.50%',
        trail: '0 min down',
        warning: false,
      },
    ]);
  });

  it('says ALL ON TARGET when every site meets it, and leaves the count out with no sites', () => {
    const all = weeklyModel(weekly({ sites: [site({ site: 'MuvMi', tier: 1, target: 0.9995 })] }));
    expect(all.sections.find((x) => x.title?.startsWith('UPTIME'))!.title).toBe(
      'UPTIME BY SITE · ALL ON TARGET',
    );
    expect(all.lines[1]).toContain('· 1/1 sites on target (30 d) ·');
    const none = weeklyModel(weekly({ sites: [] }));
    expect(none.sections.some((x) => x.title?.startsWith('UPTIME'))).toBe(false);
    expect(none.lines[1]).toBe('Uptime all sites 99.95% · 2 DOWN · 1 PROBLEM · maintenance excluded');
  });

  it('puts the furthest below first', () => {
    const rows = weeklyModel(
      weekly({
        sites: [
          site({ site: 'A', tier: 2, target: 0.999, downMinutes: 50 }),
          site({ site: 'B', tier: 1, target: 0.9995, downMinutes: 200 }),
        ],
      }),
    ).sections.find((x) => x.title?.startsWith('UPTIME'))!.rows;
    expect(rows.map((r) => r.text.split(' · ')[0])).toEqual(['B', 'A']);
  });

  it('renders the section in the Chat card and the email', () => {
    const m = weeklyModel(weekly());
    expect(JSON.stringify(reportChat(m, 'weekly'))).toContain('UPTIME BY SITE · 1 BELOW TARGET');
    const email = weeklyEmail(m, weekly());
    expect(email.text).toContain('MuvMi · Tier 1 · 30 d 99.90% · target 99.95% · this week 99.57%');
  });

  it('lists incidents with their down time, outline severity and the ladder', () => {
    const s = weeklyModel(weekly()).sections.find((x) => x.title?.startsWith('INCIDENTS'))!;
    expect(s.title).toBe('INCIDENTS · ALL RECOVERED');
    expect(s.rows).toEqual([
      {
        label: 'Was down',
        text: 'MuvMi · Fri 25 Sep 09:48 · Timeout ×2 · 504 ×1 · reached L1, acked by Arm 10:07 · client updated by Bua 10:12 · no root cause yet',
        trail: '43 min',
      },
      {
        label: 'Was down',
        text: 'VOCA · Mon 21 Sep 03:12 · Hard fail, flapped ×4 · outside response hours',
        trail: '41 min',
      },
      {
        label: 'Was problem',
        text: 'Fuji Links · Fri 25 Sep 09:52 · Slow, p50 5.8 s · acked by Ploy 09:58',
        trail: '22 min',
      },
    ]);
  });

  it('puts the worst first, as the board: DOWN before PROBLEM, then the longest; a tie by start', () => {
    const order = weeklyModel(
      weekly({
        incidents: [
          incident({ site: 'Fuji Links', severity: 'problem', minutes: 22 }),
          incident({ site: 'ORCA Thailand', minutes: 8 }),
          incident({ site: 'DxT AI', severity: 'problem', minutes: 26 * 60 }),
          incident({ site: 'VOCA', minutes: 41, startedAt: bkk('2026-09-21T03:12:00') }),
          incident({ site: 'MuvMi', minutes: 43, startedAt: bkk('2026-09-25T09:48:00') }),
          incident({ site: 'Tubtong', minutes: 41, startedAt: bkk('2026-09-20T10:00:00') }),
        ],
      }),
    )
      .sections.find((x) => x.title?.startsWith('INCIDENTS'))!
      .rows.map((r) => r.text.split(' · ')[0]);
    expect(order).toEqual(['MuvMi', 'Tubtong', 'VOCA', 'ORCA Thailand', 'DxT AI', 'Fuji Links']);
  });

  it('says "— (no DOWN inside response hours)" for a tier with none (spec §15.7)', () => {
    const row = weeklyModel(weekly()).sections.find((x) => x.rows[0]?.label?.startsWith('MTTA'))!.rows[0]!;
    expect(row).toEqual({
      label: 'MTTA DOWN (response hours)',
      text: 'Tier 1 19 min · Tier 2 —',
      note: 'Tier 1 over the 15 min target · Tier 2 — (no DOWN inside response hours)',
      warning: true,
    });
  });

  it('words planned & quiet, coming up and the monitor itself', () => {
    const m = weeklyModel(weekly());
    const rows = (t: string) => m.sections.find((x) => x.title === t)!.rows.map((r) => [r.label, r.text]);
    expect(rows('PLANNED & QUIET')).toEqual([
      ['Maintenance', 'WeCare Studio · Fri 25 Sep 09:30–14:00 · CMS upgrade · not counted'],
      [
        'Maintenance',
        'Bangkok Airways – China · Sat 26 Sep 22:00 → Tue 29 Sep 22:00 · new hosting provider · running now · not counted',
      ],
      ['Muted', 'Cando Asia · Mon 21 Sep 10:15–11:40 (ended early) · client changing DNS · still counted'],
    ]);
    expect(rows('COMING UP')).toEqual([
      [
        undefined,
        'On call this week (Tier 1 nights and weekends): Nok, Mon 28 Sep → 5 Oct. Next: Arm, 5 → 12 Oct — swap with Nok asked, not accepted yet.',
      ],
      [undefined, 'Maintenance: Tubtong Tue 29 Sep 01:00–03:00 · WordPress plugin updates · Ploy'],
    ]);
    expect(rows('THE MONITOR ITSELF')).toEqual([
      [
        undefined,
        'Monitor ran 99.74% of rounds on time · 1 gap Sat 26 Sep 02:17–02:43 (26 min) — stored as no data, not downtime.',
      ],
      [
        undefined,
        '1 probe gap Fri 25 Sep 03:12–03:16 (SIN) — BKK and TYO still decided status · the Admins were emailed, no page.',
      ],
      [undefined, 'Only 1 active Admin (Tao), so monitor-fault alerts reach one person.'],
    ]);
  });

  it('leaves an empty section out instead of saying "none"', () => {
    const m = weeklyModel(
      weekly({
        incidents: [],
        sites: [],
        needsSomeone: [],
        planned: [],
        comingUp: [],
        onCall: { thisWeek: null, next: null },
        monitor: monitor(),
      }),
    );
    expect(m.sections.map((s) => s.title)).toEqual([undefined, 'THE MONITOR ITSELF']);
    expect(m.textLine).toBe('Website week 21–27 Sep · 14/17 sites had no downtime');
  });

  it('counts the incidents still failing in the section title', () => {
    const m = weeklyModel(weekly({ incidents: [incident({ failing: true, state: 'acknowledged' })] }));
    const s = m.sections.find((x) => x.title?.startsWith('INCIDENTS'))!;
    expect(s.title).toBe('INCIDENTS · 1 NOT RECOVERED');
    expect(s.rows[0]!.label).toBe('Down');
  });
});

describe('root cause and the MTTA note (message-checker S14)', () => {
  it('words a resolved incident by its root cause, as the board does', () => {
    const d = digestModel(digest({ yesterday: [incident({ rootCause: 'cert renewed' })] }));
    expect(d.sections[1]!.rows[0]!.text).toBe(
      'ORCA Thailand DOWN 8 min (22:14, hard fail) — cert renewed, resolved',
    );
    const w = weeklyModel(weekly({ incidents: [incident({ rootCause: 'provider reboot' })] }));
    expect(w.sections.find((x) => x.title?.startsWith('INCIDENTS'))!.rows[0]!.text).toBe(
      'ORCA Thailand · Thu 24 Sep 22:14 · Hard fail · provider reboot',
    );
  });

  it('Tier 1 with no DOWN says so without "outside response hours" (it is 24/7)', () => {
    const row = weeklyModel(
      weekly({
        mtta: [
          { tier: 1, seconds: null, targetMin: 15 },
          { tier: 3, seconds: 420, targetMin: null },
        ],
      }),
    ).sections.find((x) => x.rows[0]?.label?.startsWith('MTTA'))!.rows[0]!;
    expect(row.text).toBe('Tier 1 — · Tier 3 7 min');
    expect(row.note).toBe('Tier 1 — (no DOWN) · Tier 3 — no L1 step to compare with');
  });

  it('puts the note under the value in Chat, never joined by a second dash', () => {
    const msg = reportChat(weeklyModel(weekly()), 'weekly');
    const widget = msg.cardsV2[0]!.card.sections.flatMap((s) => s.widgets).find(
      (w) => 'decoratedText' in w && w.decoratedText.topLabel.startsWith('MTTA'),
    ) as { decoratedText: { text: string; bottomLabel?: string } };
    expect(widget.decoratedText.text).toBe('Tier 1 19 min · Tier 2 —');
    expect(widget.decoratedText.bottomLabel).toBe(
      'Tier 1 over the 15 min target · Tier 2 — (no DOWN inside response hours)',
    );
  });
});

describe('rendering', () => {
  it('posts one card with the text line first — mentions only there', () => {
    const msg = reportChat(weeklyModel(weekly()), 'weekly');
    expect(msg.text.startsWith('Website week 21–27 Sep')).toBe(true);
    const card = msg.cardsV2[0]!.card;
    expect(card.header).toEqual({
      title: 'Website week · Mon 21 – Sun 27 Sep',
      subtitle: 'Week: 14/17 sites had no downtime',
    });
    expect(JSON.stringify(card)).not.toContain('<users/');
    expect(card.sections.map((s) => s.header)).toContain('NEEDS SOMEONE');
    expect(card.sections.at(-1)!.widgets[0]).toEqual({
      buttonList: {
        buttons: [
          { text: 'Open incidents', onClick: { openLink: { url: 'https://monitor.example/incidents' } } },
        ],
      },
    });
  });

  it('emails the CEO the same sections with a plain-text part', () => {
    const m = weeklyModel(weekly());
    const mail = weeklyEmail(m, weekly());
    expect(mail.subject).toBe('DxT Monitor · Weekly summary · 21–27 Sep');
    expect(mail.text).toContain('NEEDS SOMEONE');
    expect(mail.text).toContain('Tier 2 — (no DOWN inside response hours)');
    expect(mail.html).toContain('Bangkok Airways – China');
    expect(mail.html).not.toContain('<users/');
    // Escaped: a reason can't inject markup (names lose < > anyway, as in every Chat line).
    const evil = weeklyEmail(
      weeklyModel(weekly({ planned: [{ ...weekly().planned[0]!, reason: '<img src=x> & "y"' }] })),
      weekly(),
    );
    expect(evil.html).toContain('&lt;img src=x&gt; &amp; &quot;y&quot;');
    expect(evil.html).not.toContain('<img');
  });
});
