import { describe, expect, it } from 'vitest';
import { handCheckOf, sitesOkByHand } from './hand-check';
import type { HandCheckEntry, MonitorFault, OverviewSite, OverviewViewer } from './types';

// MainFault sample (spec §30, test data only): the fault from 02:17, Ploy on call @mentioned at 02:20,
// five Tier 1 sites and six Tier 2–3; at 02:31 Tao checks Bangkok Airways – Taiwan OK and opens
// realme.link by hand as INC-0143.
const at = (hhmm: string) => `2026-09-26T${hhmm}:00+07:00`;
const PASS = { BKK: 'pass', SIN: 'none', TYO: 'none' } as const;
const site = (name: string, over: Partial<OverviewSite> = {}): OverviewSite => ({
  id: `s-${name}`,
  name,
  url: `https://${name}.example.test/`,
  tier: 1,
  status: 'ok',
  statusSince: at('00:00'),
  checkedAt: at('02:17'),
  ownerId: 'u-arm',
  ownerName: 'Arm',
  backupId: null,
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
const SITES = [
  site('MuvMi'),
  site('realme.link', { ownerId: 'u-nok', ownerName: 'Nok' }),
  site('Taiwan'),
  site('China'),
  site('ENEOS'),
  ...['a', 'b', 'c', 'd', 'e', 'f'].map((n) => site(`t2-${n}`, { tier: 2 })),
];
const FAULT: MonitorFault = {
  sweepAt: at('02:17'),
  alertedAt: at('02:20'),
  asOf: at('02:17'),
  onCallName: 'Ploy',
};
const tao: OverviewViewer = { id: 'u-tao', name: 'Tao', kind: 'admin' };
const AFTER: HandCheckEntry[] = [
  {
    siteId: 's-realme.link',
    outcome: 'down',
    at: at('02:31'),
    by: 'Tao',
    incidentId: 'i-143',
    incidentNumber: 143,
  },
  { siteId: 's-Taiwan', outcome: 'ok', at: at('02:31'), by: 'Tao', incidentId: null, incidentNumber: null },
];

describe('handCheckOf (S12b, spec §30.2–3)', () => {
  it('Before hand check: one row per Tier 1 site, nothing checked, the on-call line', () => {
    const card = handCheckOf(SITES, [], tao, FAULT, new Date(at('02:40')));
    expect(card.rows.map((r) => r.name)).toEqual(['MuvMi', 'realme.link', 'Taiwan', 'China', 'ENEOS']);
    expect(card.count).toBe('0 of 5 checked since 02:17');
    expect(card.shortCount).toBe('0 of 5 checked');
    expect(card.footer).toBe('Nothing checked yet — Ploy (on call) was @mentioned at 02:20.');
    expect(card.otherTiers).toBe('Tier 2–3 (6 sites): not needed — the hand check covers Tier 1 only.');
    expect(card.rows[0]).toMatchObject({
      line: { kind: 'none', text: 'Not checked yet' },
      canCheck: true,
      canOpen: true,
    });
  });

  it('After hand check: the latest per row, the opened incident links, its buttons go', () => {
    const card = handCheckOf(SITES, AFTER, tao, FAULT, new Date(at('02:40')));
    expect(card.count).toBe('2 of 5 checked since 02:17');
    expect(card.footer).toBe('Next check due by 03:01 — every 30 min while monitoring is degraded.');
    const realme = card.rows.find((r) => r.name === 'realme.link')!;
    expect(realme.line).toEqual({
      kind: 'incident',
      text: 'INC-0143 opened · Tao 02:31',
      incidentId: 'i-143',
    });
    expect(realme).toMatchObject({ canCheck: false, canOpen: false });
    expect(card.rows.find((r) => r.name === 'Taiwan')).toMatchObject({
      line: { kind: 'ok', text: 'Checked OK · Tao 02:31' },
      canCheck: true,
      canOpen: true,
    });
  });

  it('a newer Loads OK replaces an older one (the row keeps the latest)', () => {
    const card = handCheckOf(
      SITES,
      [
        {
          siteId: 's-MuvMi',
          outcome: 'ok',
          at: at('03:02'),
          by: 'Ploy',
          incidentId: null,
          incidentNumber: null,
        },
        {
          siteId: 's-MuvMi',
          outcome: 'ok',
          at: at('02:31'),
          by: 'Tao',
          incidentId: null,
          incidentNumber: null,
        },
      ],
      tao,
      FAULT,
      new Date(at('02:40')),
    );
    expect(card.rows[0]!.line.text).toBe('Checked OK · Ploy 03:02');
  });

  it('a site the engine already opened an incident for: Loads OK only', () => {
    const open = site('MuvMi', {
      incident: {
        id: 'i-142',
        number: 142,
        state: 'needs_root_cause',
        severity: 'down',
        dropSeverity: 'down',
        trigger: 'hard_fail',
        level: 0,
        startedAt: at('00:00'),
        detectedAt: at('00:00'),
        recoveredAt: at('00:10'),
        ackedBy: 'Arm',
        cause: null,
      },
    });
    expect(handCheckOf([open], [], tao, FAULT, new Date(at('02:40'))).rows[0]).toMatchObject({
      canCheck: true,
      canOpen: false,
      openIncident: { id: 'i-142', label: 'Open INC-0142', downAgain: 'relapse' },
    });
  });

  it.each([
    ['a PROBLEM is raised', { severity: 'problem', dropSeverity: 'problem', state: 'unacked' }, 'raise'],
    [
      'a DOWN still down has no Down again',
      { severity: 'down', dropSeverity: 'down', state: 'unacked' },
      null,
    ],
    [
      'a DOWN whose key page carries on (D-023) relapses',
      { severity: 'down', dropSeverity: 'problem', state: 'acknowledged' },
      'relapse',
    ],
  ] as const)('Down again (D-055 item 7): %s', (_case, over, expected) => {
    const s = site('MuvMi', {
      incident: {
        id: 'i-142',
        number: 142,
        trigger: 'hard_fail',
        level: 0,
        startedAt: at('00:00'),
        detectedAt: at('00:00'),
        recoveredAt: null,
        ackedBy: null,
        cause: null,
        ...over,
      },
    });
    expect(handCheckOf([s], [], tao, FAULT, new Date(at('02:40'))).rows[0]!.openIncident?.downAgain).toBe(
      expected,
    );
  });

  it('Down again is for those who may act, never on a muted site', () => {
    const inc = {
      id: 'i-142',
      number: 142,
      state: 'monitoring',
      severity: 'down',
      dropSeverity: 'down',
      trigger: 'hard_fail',
      level: 0,
      startedAt: at('00:00'),
      detectedAt: at('00:00'),
      recoveredAt: at('00:10'),
      ackedBy: null,
      cause: null,
    } as const;
    const am = handCheckOf(
      [site('MuvMi', { incident: inc })],
      [],
      { id: 'u-bua', name: 'Bua', kind: 'am' },
      FAULT,
    );
    expect(am.rows[0]!.openIncident?.downAgain).toBeNull();
    const muted = handCheckOf(
      [site('MuvMi', { incident: inc, mutedUntil: at('03:00') })],
      [],
      tao,
      FAULT,
      new Date(at('02:40')),
    );
    expect(muted.rows[0]!.openIncident?.downAgain).toBeNull();
  });

  it('who presses (§30.3): the AM reads only; a Responder on another site is told who can', () => {
    const am = handCheckOf(SITES, [], { id: 'u-bua', name: 'Bua', kind: 'am' }, FAULT, new Date(at('02:40')));
    expect(am.rows[0]).toMatchObject({ canCheck: false, canOpen: false, readOnly: 'Read only' });
    const nok = handCheckOf(
      SITES,
      [],
      { id: 'u-nok', name: 'Nok', kind: 'responder' },
      FAULT,
      new Date(at('02:40')),
    );
    expect(nok.rows.find((r) => r.name === 'realme.link')).toMatchObject({ canOpen: true, readOnly: null });
    expect(nok.rows[0]!.readOnly).toBe('Only Arm, the person on call or an Admin');
  });

  it('the person on call acts on every Tier 1 site', () => {
    const ploy = handCheckOf(
      SITES,
      [],
      { id: 'u-ploy', name: 'Ploy', kind: 'responder', onCallNow: true },
      FAULT,
      new Date(at('02:40')),
    );
    expect(ploy.rows.every((r) => r.canOpen)).toBe(true);
  });

  it('nobody on call and no Tier 2–3: the plain lines', () => {
    const card = handCheckOf(
      SITES.slice(0, 5),
      [],
      tao,
      { ...FAULT, onCallName: null },
      new Date(at('02:40')),
    );
    expect(card.footer).toBe('Nothing checked yet.');
    expect(card.otherTiers).toBeNull();
  });
});

describe('sitesOkByHand — the Sites OK caption (§30.1)', () => {
  it.each([
    ['before the check', [], 'As of 02:17 · hand-check Tier 1 below'],
    ['one opened by hand at 02:31', AFTER, '1 down by hand check 02:31 · the rest as of 02:17'],
  ] as const)('%s', (_case, checks, expected) => {
    expect(sitesOkByHand(checks, '02:17')).toBe(expected);
  });
});

describe('handCheckOf — paused and overdue (spec check M2, L12)', () => {
  it('a muted site: no Down, and the row says why', () => {
    const muted = site('MuvMi', { mutedUntil: at('03:00') });
    expect(handCheckOf([muted], [], tao, FAULT, new Date(at('02:40'))).rows[0]).toMatchObject({
      canOpen: false,
      canCheck: true,
      paused: 'Muted until 03:00 — no alert goes out',
    });
  });
  it('past 30 min the footer says the check is overdue', () => {
    expect(handCheckOf(SITES, AFTER, tao, FAULT, new Date(at('03:05'))).footer).toBe(
      'Check overdue since 03:01 — every 30 min while monitoring is degraded.',
    );
  });
  it('opened by hand: the status reads "by hand 02:31", not "as of" the sweep', () => {
    const row = handCheckOf(SITES, AFTER, tao, FAULT, new Date(at('02:40'))).rows.find(
      (r) => r.name === 'realme.link',
    )!;
    expect(row.statusNote).toBe('by hand 02:31');
  });
});
