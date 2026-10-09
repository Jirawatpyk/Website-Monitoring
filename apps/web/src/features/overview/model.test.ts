import { describe, expect, it } from 'vitest';
import {
  attnMeta,
  bannersOf,
  chipOf,
  countsOf,
  eventLine,
  liveIssues,
  nextStep,
  openCaption,
  phoneHref,
  reasonLine,
  reasonOf,
  recentEvents,
  sinceText,
  sitesOkCaption,
  thirdCard,
  tileState,
  withAck,
} from './model';
import type { OverviewEvent, OverviewIncident, OverviewSite, OverviewViewer } from './types';

// Main3 / MOverview4 "2 banners + more" at Fri 25 Sep 2026 10:07 (UTC+7, spec §1). Names, times and
// numbers are the boards' mock data, used here as test fixtures only (spec §21.11).
const NOW = new Date('2026-09-25T03:07:12Z');
const at = (hhmm: string) => `2026-09-25T${hhmm}:00+07:00`;

const PASS = { BKK: 'pass', SIN: 'pass', TYO: 'pass' } as const;
const FAIL = { BKK: 'fail', SIN: 'fail', TYO: 'fail' } as const;

const site = (name: string, over: Partial<OverviewSite> = {}): OverviewSite => ({
  id: `s-${name}`,
  name,
  tier: 1,
  status: 'ok',
  statusSince: at('06:00'),
  checkedAt: at('10:07'),
  ownerId: 'u-arm',
  ownerName: 'Arm',
  backupId: 'u-ploy',
  amId: null,
  mutedUntil: null,
  muteReason: null,
  incident: null,
  locations: PASS,
  chainSince: null,
  p50Ms: 400,
  series: [],
  failed: [],
  uptime: null,
  ...over,
});

const incident = (number: number, over: Partial<OverviewIncident> = {}): OverviewIncident => ({
  id: `i-${number}`,
  number,
  state: 'unacked',
  severity: 'down',
  trigger: 'hard_fail',
  level: 0,
  startedAt: at('09:48'),
  detectedAt: at('09:49'),
  recoveredAt: null,
  ackedBy: null,
  cause: null,
  ...over,
});

const muvmi = site('MuvMi', {
  status: 'down',
  statusSince: at('09:49'),
  amId: 'u-bua',
  locations: FAIL,
  p50Ms: null,
  incident: incident(142, { state: 'escalated', level: 1, cause: 'Timeout ×2 · 504 ×1' }),
});
const realme = site('realme.link', {
  status: 'down',
  ownerId: 'u-nok',
  backupId: 'u-arm',
  locations: FAIL,
  incident: incident(143, {
    startedAt: at('10:01'),
    detectedAt: at('10:01'),
    cause: 'Connection refused ×3',
  }),
});
const tubtong = site('Tubtong', {
  status: 'down',
  ownerId: 'u-ploy',
  amId: 'u-bua',
  locations: FAIL,
  incident: incident(144, { startedAt: at('10:04'), detectedAt: at('10:04'), cause: '503 ×3' }),
});
const cando = site('Cando Asia', {
  status: 'down',
  tier: 2,
  ownerId: 'u-nok',
  amId: 'u-bua',
  locations: FAIL,
  incident: incident(140, {
    state: 'acknowledged',
    ackedBy: 'Nok',
    startedAt: at('09:55'),
    cause: 'DNS not resolving ×3',
  }),
});
const fuji = site('Fuji Links', {
  status: 'problem',
  tier: 2,
  ownerId: 'u-ploy',
  incident: incident(141, {
    severity: 'problem',
    trigger: 'slow',
    state: 'acknowledged',
    ackedBy: 'Ploy',
    startedAt: at('09:52'),
    cause: 'slow, p50 5.8 s',
  }),
});
const eneos = site('ENEOS Industrial', {
  ownerId: 'u-ploy',
  backupId: 'u-arm',
  locations: { BKK: 'pass', SIN: 'chain', TYO: 'pass' },
  chainSince: at('09:31'),
});
const orca = site('ORCA Thailand', {
  ownerId: 'u-tao',
  incident: incident(139, { state: 'needs_root_cause', recoveredAt: at('08:12'), startedAt: at('07:58') }),
});
const games = site('DxT Games', {
  tier: 3,
  ownerId: 'u-tao',
  mutedUntil: at('18:00'),
  muteReason: 'redeploying build',
});
const baChina = site('Bangkok Airways – China', {
  tier: 2,
  locations: { BKK: 'pass', SIN: 'blocked', TYO: 'blocked' },
});
const voca = site('VOCA', { tier: 2, ownerId: 'u-ploy', backupId: 'u-tao' });

const SITES = [voca, games, baChina, orca, eneos, fuji, cando, tubtong, realme, muvmi];

const tao: OverviewViewer = { id: 'u-tao', name: 'Tao', kind: 'admin' };
const arm: OverviewViewer = { id: 'u-arm', name: 'Arm', kind: 'responder' };
const bua: OverviewViewer = { id: 'u-bua', name: 'Bua', kind: 'am' };
const ceo: OverviewViewer = { id: 'u-ceo', name: 'CEO', kind: 'ceo' };
const mint: OverviewViewer = { id: 'u-mint', name: 'Mint', kind: 'viewer' };

describe('Live issues inclusion and reason (§21.4)', () => {
  it.each<[string, OverviewSite, string | null]>([
    ['Down', muvmi, 'down'],
    ['Problem', fuji, 'problem'],
    ['Maintenance', site('Maint', { status: 'maintenance' }), 'maintenance'],
    ['an incident waiting for its root cause on an OK site', orca, 'root_cause'],
    [
      'a Monitoring incident (recovered, waiting) too',
      site('Mon', { incident: incident(1, { state: 'monitoring' }) }),
      'root_cause',
    ],
    ['a TLS chain location warning', eneos, 'location'],
    ['a mute', games, 'muted'],
    ['an expired mute is not an issue', site('Old', { mutedUntil: at('09:00') }), null],
    ['blocked by bot protection, verified OK, is not an issue', baChina, null],
    ['a plain OK site is not an issue', voca, null],
    [
      'Down outranks a mute and a chain warning',
      site('Both', { ...muvmi, mutedUntil: at('18:00'), locations: { ...FAIL, SIN: 'chain' } }),
      'down',
    ],
    [
      'a root cause outranks a chain warning',
      site('RC', { ...orca, locations: { ...PASS, TYO: 'chain' } }),
      'root_cause',
    ],
  ])('%s', (_name, s, kind) => {
    expect(reasonOf(s, NOW)?.kind ?? null).toBe(kind);
  });

  it('Since is the start of that same reason', () => {
    expect(reasonOf(muvmi, NOW)?.since).toBe(at('09:48')); // first failed check, not "confirmed"
    expect(reasonOf(orca, NOW)?.since).toBe(at('08:12')); // back up
    expect(reasonOf(eneos, NOW)?.since).toBe(at('09:31'));
    expect(reasonOf(games, NOW)?.since).toBeNull(); // mute start unknown until S09 (D-032)
    expect(sinceText(at('09:48'), NOW)).toEqual({ duration: '19 min', at: 'since 09:48' });
    expect(sinceText(at('08:12'), NOW)).toEqual({ duration: '1 h 55 min', at: 'since 08:12' });
    expect(sinceText(null, NOW)).toBeNull();
  });
});

describe('Live issues sort (§21.4)', () => {
  it('Down escalated › unacked › acked, then Problem, then the rest by tier and longest Since', () => {
    expect(liveIssues(SITES, NOW).map((i) => i.site.name)).toEqual([
      'MuvMi', // escalated
      'realme.link', // unacked, Tier 1, down longer than Tubtong
      'Tubtong',
      'Cando Asia', // acked
      'Fuji Links', // Problem
      'ORCA Thailand', // Tier 1, since 08:12
      'ENEOS Industrial', // Tier 1, since 09:31
      'DxT Games', // Tier 3
    ]);
  });

  it('inside a group the longest Since comes first, then the name', () => {
    const a = site('A', { status: 'problem', statusSince: at('09:00') });
    const b = site('B', { status: 'problem', statusSince: at('08:00') });
    const c = site('C', { status: 'problem', statusSince: at('08:00') });
    expect(liveIssues([a, c, b], NOW).map((i) => i.site.name)).toEqual(['B', 'C', 'A']);
  });
});

describe('reason lines', () => {
  const line = (s: OverviewSite, phone = false) =>
    reasonLine({ site: s, reason: reasonOf(s, NOW)! }, { phone });
  it.each<[OverviewSite, string, string]>([
    [muvmi, 'Timeout ×2 · 504 ×1', 'Escalated L1 · Timeout ×2 · 504 ×1'],
    [realme, 'Connection refused ×3', 'Unacked · Connection refused ×3'],
    [cando, 'DNS not resolving ×3', 'Acked by Nok · DNS not resolving ×3'],
    [fuji, 'Slow, p50 5.8 s', 'Slow, p50 5.8 s'],
    [orca, 'Back up — root cause not added yet', 'Root cause not added yet'],
    [eneos, 'TLS chain error at SIN · BKK, TYO OK', 'TLS chain error at SIN'],
    [games, 'Muted · redeploying build', 'Muted until 18:00'],
  ])('%#: desktop / phone', (s, desktop, phone) => {
    expect(line(s)).toBe(desktop);
    expect(line(s, true)).toBe(phone);
  });

  it('falls back to the trigger word when no cause was recorded', () => {
    expect(line(site('X', { status: 'down', incident: incident(9) }))).toBe('Hard fail');
  });
});

describe('Next step by role (§21.4, §21.8, D-016, D-031, D-032)', () => {
  const step = (v: OverviewViewer, s: OverviewSite) => {
    const n = nextStep(v, { site: s, reason: reasonOf(s, NOW)! });
    return n.kind === 'ack' ? 'Acknowledge' : n.label;
  };
  it.each<[string, OverviewViewer, OverviewSite, string]>([
    ['Admin acks any unacked DOWN', tao, realme, 'Acknowledge'],
    ['Responder acks a site they own', arm, muvmi, 'Acknowledge'],
    ['Responder acks a site they back up', arm, realme, 'Acknowledge'],
    ['Responder can only open a site they neither own nor back up', arm, tubtong, 'Open INC-0144'],
    ['AM never acknowledges (D-031)', bua, muvmi, 'Open INC-0142'],
    ['CEO never acknowledges', ceo, muvmi, 'Open INC-0142'],
    ['Viewer opens the incident read-only', mint, muvmi, 'Open INC-0142'],
    ['an acked DOWN opens the incident', tao, cando, 'Open INC-0140'],
    ['a PROBLEM opens the incident', tao, fuji, 'Open INC-0141'],
    ['"Add root cause" reads "Open INC-…" until S07', tao, orca, 'Open INC-0139'],
    ['a location warning → View checks', mint, eneos, 'View checks'],
    ['a mute → View site', tao, games, 'View site'],
  ])('%s', (_name, v, s, expected) => {
    expect(step(v, s)).toBe(expected);
  });

  it('phones open the incident for incident rows and Site detail for the rest (§17)', () => {
    const href = (s: OverviewSite) => phoneHref({ site: s, reason: reasonOf(s, NOW)! });
    expect(href(muvmi)).toBe('/incidents/i-142');
    expect(href(fuji)).toBe('/incidents/i-141');
    expect(href(orca)).toBe('/incidents/i-139');
    expect(href(eneos)).toBe('/sites/s-ENEOS Industrial');
    expect(href(games)).toBe('/sites/s-DxT Games');
  });
});

describe('Banners (§21.1)', () => {
  it('two shown — escalated first, then tier, then longest down — and "and N more"', () => {
    const b = bannersOf(SITES, NOW);
    expect(b.shown.map((x) => x.site.name)).toEqual(['MuvMi', 'realme.link']);
    expect(b.more).toBe(1);
    expect(b.shown[0]).toMatchObject({ escalated: true, level: 1, downMinutes: 19, unackedMinutes: 18 });
  });

  it('an acknowledgement removes the banner at once and the next moves up', () => {
    const b = bannersOf(withAck(SITES, 'i-142', 'Tao'), NOW);
    expect(b.shown.map((x) => x.site.name)).toEqual(['realme.link', 'Tubtong']);
    expect(b.more).toBe(0);
  });

  it('a PROBLEM and an acked DOWN never get one', () => {
    expect(bannersOf([fuji, cando], NOW).shown).toEqual([]);
  });
});

describe('Counts and KPI captions (§21.2–3)', () => {
  const c = countsOf(SITES);
  it('counts monitored sites by real status; Open = before Resolved; escalated ⊂ unacked', () => {
    expect(c).toEqual({ monitored: 10, ok: 5, down: 4, problem: 1, open: 6, unacked: 3, escalated: 1 });
    expect(sitesOkCaption(c)).toBe('4 down · 1 problem');
    expect(openCaption(c)).toBe('3 unacked (1 escalated)');
  });
  it('captions with nothing wrong', () => {
    const calm = countsOf([voca, baChina]);
    expect(sitesOkCaption(calm)).toBe('Nothing down or in problem');
    expect(openCaption(calm)).toBe('None open');
    expect(openCaption(countsOf([cando]))).toBe('All acknowledged');
  });
});

describe('Chips, header line and the phone third card (§21.8)', () => {
  const issues = liveIssues(SITES, NOW);
  it.each<[OverviewViewer, OverviewSite, string | null]>([
    [tao, orca, 'Yours'],
    [tao, voca, 'Backup'],
    [arm, muvmi, 'Yours'],
    [arm, realme, 'Backup'],
    [bua, muvmi, 'Your client'],
    [bua, realme, null],
    [ceo, muvmi, null],
    [mint, muvmi, null],
  ])('%o on %o', (v, s, label) => {
    expect(chipOf(v, s)?.label ?? null).toBe(label);
  });

  it('attnMeta per role', () => {
    const c = countsOf(SITES);
    expect(attnMeta(tao, issues, c)).toBe('8 of 10 monitored sites · 3 unacked (1 escalated) · 2 yours');
    expect(attnMeta(bua, issues, c)).toBe(
      '8 of 10 monitored sites · 3 unacked (1 escalated) · 3 your clients',
    );
    expect(attnMeta(mint, issues, c)).toBe('8 of 10 monitored sites · 3 unacked (1 escalated)');
  });

  it('third card: Yours / Your clients / Uptime 30 d', () => {
    expect(thirdCard(arm, issues, 0.9998)).toEqual({ value: '3', label: 'Yours' });
    expect(thirdCard(bua, issues, 0.9998)).toEqual({ value: '3', label: 'Your clients' });
    expect(thirdCard(ceo, issues, 0.9998)).toEqual({ value: '99.98%', label: 'Uptime 30 d' });
    expect(thirdCard(mint, issues, 0.9998)).toEqual({ value: '99.98%', label: 'Uptime 30 d' });
  });
});

describe('Tiles (§21.6)', () => {
  it.each<[OverviewSite, string, string[]]>([
    [muvmi, 'Escalated L1 · unacked', ['bell']],
    [realme, 'Unacked', ['bell']],
    [cando, 'Acked · Nok', ['bell']],
    [fuji, 'Slow · 15 min', ['bell']],
    [orca, 'Root cause due', ['bell']],
    [eneos, 'TLS chain · SIN', ['shield-alert']],
    [games, 'Muted', ['eye-off']],
    [baChina, 'Blocked by bot protection · verified', []],
    [voca, '', []],
    [site('New', { status: null }), 'No data yet', []],
  ])('%#', (s, state, icons) => {
    const t = tileState(s, NOW);
    expect(t.state).toBe(state);
    expect(t.markers.map((m) => m.icon)).toEqual(icons);
  });
});

describe('Recent events (§21.6, §16.11, D-032)', () => {
  const ev = (type: string, over: Partial<OverviewEvent> = {}): OverviewEvent => ({
    id: `${type}-${over.at ?? ''}`,
    type,
    at: at('10:00'),
    actorName: 'Nok',
    payload: {},
    incidentNumber: 140,
    severity: 'down',
    trigger: 'hard_fail',
    siteName: 'Cando Asia',
    ...over,
  });
  it.each<[OverviewEvent, string | null]>([
    [ev('detected', { payload: { confirmingLocations: 3 } }), 'Cando Asia DOWN confirmed — 3/3 locations'],
    [
      ev('detected', { severity: 'problem', trigger: 'slow', payload: { summary: 'slow, p50 5.8 s' } }),
      'Cando Asia PROBLEM — Slow, p50 5.8 s',
    ],
    [
      ev('escalated_to_down', { payload: { confirmingLocations: 2 } }),
      'Cando Asia DOWN confirmed — 2/3 locations',
    ],
    [ev('acknowledged'), 'INC-0140 acked by Nok'],
    [ev('ack_undone'), 'INC-0140 acknowledgement undone by Nok'],
    [ev('recovered'), 'Cando Asia back up — root cause needed'],
    [ev('recovered', { severity: 'problem' }), 'Cando Asia back to OK'],
    [ev('auto_resolved', { severity: 'problem' }), 'Cando Asia back to OK — resolved automatically'],
    [ev('relapsed'), 'Cando Asia DOWN again'],
    [ev('google_chat'), null],
    [ev('evidence'), null],
  ])('%#', (e, expected) => {
    expect(eventLine(e)).toBe(expected);
  });

  it('newest first, unworded ones skipped, at most 7', () => {
    const list = Array.from({ length: 10 }, (_, n) =>
      ev(n % 3 === 0 ? 'google_chat' : 'acknowledged', { id: `e${n}`, at: at(`09:${String(10 + n)}`) }),
    );
    const out = recentEvents(list, NOW);
    expect(out).toHaveLength(6);
    expect(out[0]).toEqual({ id: 'e8', time: '09:18', text: 'INC-0140 acked by Nok' });
  });
});
