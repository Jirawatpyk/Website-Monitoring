import { describe, expect, it } from 'vitest';
import type { CheckOutcome, ProbeLocation } from '@dxt/shared';
import { EXPIRY_FRESH_MS, expiryIssue, type ExpiryFact } from './expiry';
import type { OpenIncident, StoredCheck, Verification } from './monitor';
import { decideSite, NEW_MONITOR, type MonitorCarry, type SiteMonitor, type SiteSnapshot } from './site';

// S13 (FR-11, D-066; PRD §5 "SSL certificate expires within 14 days / domain within 30 days"). INC-0136
// DxT AI (Tier 3): "SSL certificate expires in 13 days (Tue 6 Oct)" on Wed 23 Sep 09:00 (ChatAlert,
// spec §2 table). Rounds as crawler.test.ts (3-minute interval). The round is Wed 23 Sep 09:00 Bangkok.
const R = Date.parse('2026-09-23T02:00:00Z');
const at = (sec: number) => new Date(R + sec * 1000);
const NOW = at(260);
const HOUR = 3_600_000;
const LOCATIONS: ProbeLocation[] = ['BKK', 'SIN', 'TYO'];

const check = (location: ProbeLocation, outcome: CheckOutcome, sec: number): StoredCheck => ({
  location,
  outcome,
  checkedAt: at(sec),
  attempt: 1,
  statusCode: outcome === 'fail' ? 500 : 200,
  error: null,
  responseMs: 800,
  keywordMissing: [],
  keywordForbidden: [],
});
const all = (outcome: CheckOutcome, over: Partial<StoredCheck> = {}) =>
  LOCATIONS.map((l, i) => ({ ...check(l, outcome, 1 + i), ...over }));
const failed = () => [
  ...all('fail'),
  ...LOCATIONS.map((l, i) => ({ ...check(l, 'fail', 31 + i), attempt: 2 as const })),
];
const clean = all('pass');

/** The 06:00 read (Bangkok) of the same day: 3 h before the round. */
const READ = new Date(R - 3 * HOUR);
/** A read with the certificate / domain expiring on these Bangkok dates (13:00 UTC = 20:00 Bangkok). */
const fact = (
  ssl: string | null,
  domain: string | null,
  over: { readAt?: Date; sslFailed?: boolean; domainFailed?: boolean } = {},
): ExpiryFact => ({
  ssl: {
    expiresAt: ssl ? new Date(`${ssl}T13:00:00Z`) : null,
    readAt: ssl ? (over.readAt ?? READ) : null,
    failed: over.sslFailed ?? false,
  },
  domain: {
    expiresAt: domain ? new Date(`${domain}T13:00:00Z`) : null,
    readAt: domain ? (over.readAt ?? READ) : null,
    failed: over.domainFailed ?? false,
  },
});

const monitor = (checks: StoredCheck[], over: Partial<SiteMonitor> = {}): SiteMonitor => ({
  id: 'home',
  isPrimary: true,
  url: 'https://www.dxt-ai.example/',
  slowThresholdMs: 5_000,
  allowedRedirectDomains: [],
  checks,
  carry: NEW_MONITOR,
  ...over,
});
const site = (monitors: SiteMonitor[], over: Partial<SiteSnapshot> = {}): SiteSnapshot => ({
  now: NOW,
  intervalSec: 180,
  locations: LOCATIONS,
  lastRoundAt: null,
  okRounds: 0,
  open: null,
  monitors,
  ...over,
});
const open: OpenIncident = { id: 'inc-136', state: 'unacked', severity: 'problem', hasRootCause: false };
const heldSsl: MonitorCarry = { ...NEW_MONITOR, status: 'problem', trigger: 'ssl' };
const heldDomain: MonitorCarry = { ...NEW_MONITOR, status: 'problem', trigger: 'domain' };

describe('expiryIssue', () => {
  it.each<[string, ExpiryFact | undefined, object | null]>([
    [
      'INC-0136: the certificate expires Tue 6 Oct, 13 days on Wed 23 Sep → SSL expiring',
      fact('2026-10-06', '2027-05-03'),
      {
        trigger: 'ssl',
        detail: { kind: 'ssl', expiresAt: '2026-10-06T13:00:00.000Z', daysLeft: 13 },
        at: READ,
      },
    ],
    ['14 days left is not under the line', fact('2026-10-07', '2027-05-03'), null],
    [
      'a domain 20 days out → Domain expiring',
      fact('2026-12-20', '2026-10-13'),
      { trigger: 'domain', detail: { kind: 'domain', daysLeft: 20 } },
    ],
    ['a domain 30 days out is not', fact('2026-12-20', '2026-10-23'), null],
    ['both under their lines: SSL first', fact('2026-09-30', '2026-10-01'), { trigger: 'ssl' }],
    ['Cando Asia, 55 days (§15.8) → nothing', fact('2026-11-17', '2027-05-21'), null],
    ['no read yet → nothing', undefined, null],
    ['a failed SSL read never opens one', fact('2026-09-30', '2027-05-03', { sslFailed: true }), null],
    [
      'a failed SSL read still lets a domain under 30 days through',
      fact('2026-09-30', '2026-10-01', { sslFailed: true }),
      { trigger: 'domain' },
    ],
    [
      'a read older than 36 h never opens one',
      fact('2026-09-30', null, { readAt: new Date(NOW.getTime() - EXPIRY_FRESH_MS - 1) }),
      null,
    ],
    [
      'a read exactly 36 h old still counts',
      fact('2026-09-30', null, { readAt: new Date(NOW.getTime() - EXPIRY_FRESH_MS) }),
      { trigger: 'ssl' },
    ],
  ])('%s', (_name, f, want) => {
    const got = expiryIssue(f, NOW);
    if (want === null) expect(got).toBeNull();
    else expect(got).toMatchObject(want);
  });
});

describe('decideSite — SSL / domain expiry (D-066)', () => {
  it('a passing round with the certificate 13 days out opens PROBLEM (SSL expiring), started at the read', () => {
    expect(decideSite(site([monitor(clean, { expiry: fact('2026-10-06', '2027-05-03') })]))).toMatchObject({
      kind: 'problem',
      trigger: 'ssl',
      detail: { kind: 'ssl', daysLeft: 13 },
      startedAt: READ,
      status: 'problem',
    });
  });

  it('a domain 20 days out opens PROBLEM (Domain expiring)', () => {
    expect(decideSite(site([monitor(clean, { expiry: fact('2026-12-20', '2026-10-13') })]))).toMatchObject({
      kind: 'problem',
      trigger: 'domain',
      detail: { kind: 'domain', daysLeft: 20 },
    });
  });

  it('the start is clamped to the round after the last one judged (a read before a recovery)', () => {
    const lastRoundAt = at(-180);
    expect(
      decideSite(site([monitor(clean, { expiry: fact('2026-10-06', null) })], { lastRoundAt })),
    ).toMatchObject({ kind: 'problem', startedAt: at(0) });
  });

  it('any other trigger of the round wins: a forbidden word', () => {
    const d = decideSite(
      site([monitor(all('pass', { keywordForbidden: ['บาคาร่า'] }), { expiry: fact('2026-10-06', null) })]),
    );
    expect(d).toMatchObject({ kind: 'problem', trigger: 'keyword' });
  });

  it('a DOWN outranks it (an expired certificate is the probes’ hard fail)', () => {
    expect(decideSite(site([monitor(failed(), { expiry: fact('2026-10-06', null) })]))).toMatchObject({
      kind: 'open',
      status: 'down',
    });
  });

  it('a key page failing outranks it (engine review M1)', () => {
    const key = monitor(
      LOCATIONS.map((l, i) => ({ ...check(l, 'pass', 1 + i), statusCode: 404 })),
      { id: 'booking', isPrimary: false, url: 'https://www.dxt-ai.example/booking' },
    );
    expect(decideSite(site([monitor(clean, { expiry: fact('2026-10-06', null) }), key]))).toMatchObject({
      kind: 'problem',
      trigger: 'key_page',
    });
  });

  it('opened on the first round after midnight Bangkok, it starts at that midnight, not at the 06:00 read the day before', () => {
    // Read Tue 22 Sep 06:00 (14 days left then); now Wed 23 Sep 09:00 → 13 days, crossed at 00:00 Wed.
    const read = new Date('2026-09-21T23:00:00Z');
    expect(
      decideSite(site([monitor(clean, { expiry: fact('2026-10-06', null, { readAt: read }) })])),
    ).toMatchObject({ kind: 'problem', startedAt: new Date('2026-09-22T17:00:00Z') });
  });

  it('a key page never raises it, only the primary', () => {
    const key = monitor(clean, {
      id: 'booking',
      isPrimary: false,
      url: 'https://www.dxt-ai.example/booking',
    });
    const d = decideSite(site([monitor(clean), { ...key, expiry: fact('2026-10-06', null) }]));
    expect(d).toMatchObject({ kind: 'none', status: 'ok' });
  });

  it('a blocked round the browser loaded still raises it', () => {
    const blocked = LOCATIONS.map((l, i) => ({ ...check(l, 'blocked', 1 + i), statusCode: 403 }));
    const loaded = new Map([[R, { state: 'loaded', jobId: 'j1' } as Verification]]);
    expect(
      decideSite(site([monitor(blocked, { verifications: loaded, expiry: fact('2026-10-06', null) })])),
    ).toMatchObject({ kind: 'problem', trigger: 'ssl', startedAt: READ });
  });

  it('stays open while the certificate is still under 14 days, and recovers on the read after the renewal', () => {
    expect(
      decideSite(site([monitor(clean, { carry: heldSsl, expiry: fact('2026-10-06', null) })], { open })),
    ).toMatchObject({ kind: 'none', status: 'problem' });
    // Renewed: the hourly read sees 90 days.
    expect(
      decideSite(
        site([monitor(clean, { carry: heldSsl, expiry: fact('2026-12-22', '2027-05-03') })], { open }),
      ),
    ).toMatchObject({ kind: 'recover', from: 'unacked' });
  });

  describe('no evidence holds an open one (D-066 item 3)', () => {
    it.each<[string, MonitorCarry, ExpiryFact | undefined]>([
      [
        'the latest SSL read failed (its last good date 13 days out)',
        heldSsl,
        fact('2026-10-06', null, { sslFailed: true }),
      ],
      [
        'the last good read is 40 h old',
        heldSsl,
        fact('2026-10-06', null, { readAt: new Date(NOW.getTime() - 40 * HOUR) }),
      ],
      ['the runner had no row', heldSsl, undefined],
      [
        'the domain read failed (20 days out)',
        heldDomain,
        fact('2026-12-22', '2026-10-13', { domainFailed: true }),
      ],
      [
        'slow took the carry, slow cleared, the SSL read failed (engine review M2)',
        { ...heldSsl, trigger: 'slow', slowRounds: 3 },
        fact('2026-10-06', null, { sslFailed: true }),
      ],
      [
        'renewed, but the domain read failed with its last good date 20 days out (engine review M2)',
        heldSsl,
        fact('2026-12-22', '2026-10-13', { domainFailed: true }),
      ],
    ])('%s → no recovery', (_name, carry, expiry) => {
      expect(decideSite(site([monitor(clean, { carry, expiry })], { open }))).toMatchObject({
        kind: 'none',
        status: null,
      });
    });

    it('a failed read whose last good date is past its line doesn’t hold (the renewal was read)', () => {
      expect(
        decideSite(
          site([monitor(clean, { carry: heldSsl, expiry: fact('2026-12-22', null, { sslFailed: true }) })], {
            open,
          }),
        ),
      ).toMatchObject({ kind: 'recover' });
    });

    it('a stale read on the other half doesn’t hold: the SSL PROBLEM recovers on a fresh SSL read', () => {
      expect(
        decideSite(
          site(
            [
              monitor(clean, {
                carry: heldSsl,
                expiry: fact('2026-12-22', '2027-05-03', { domainFailed: true }),
              }),
            ],
            {
              open,
            },
          ),
        ),
      ).toMatchObject({ kind: 'recover' });
    });

    it('without an open incident nothing is held', () => {
      expect(
        decideSite(
          site([monitor(clean, { carry: heldSsl, expiry: fact('2026-12-22', null, { sslFailed: true }) })]),
        ),
      ).toMatchObject({ kind: 'none', status: 'ok' });
    });
  });
});

describe('decideSite — a new cause on an open expiry incident (D-067)', () => {
  const sslOpen: OpenIncident = { ...open, trigger: 'ssl', episodeSeverity: 'problem' };
  const forbidden = all('pass', { keywordForbidden: ['บาคาร่า'] });

  it('a forbidden word on a site open for SSL expiring → new_cause (Keyword), the state kept', () => {
    expect(
      decideSite(
        site([monitor(forbidden, { carry: heldSsl, expiry: fact('2026-10-06', null) })], { open: sslOpen }),
      ),
    ).toMatchObject({ kind: 'new_cause', trigger: 'keyword', monitorId: 'home', status: 'problem' });
  });

  it('acknowledged too: the person who acked is told', () => {
    expect(
      decideSite(
        site([monitor(forbidden, { carry: heldSsl, expiry: fact('2026-10-06', null) })], {
          open: { ...sslOpen, state: 'acknowledged', acked: true },
        }),
      ),
    ).toMatchObject({ kind: 'new_cause', trigger: 'keyword' });
  });

  it('a key page answering 404 is a new cause as well', () => {
    const key = monitor(
      LOCATIONS.map((l, i) => ({ ...check(l, 'pass', 1 + i), statusCode: 404 })),
      { id: 'booking', isPrimary: false, url: 'https://www.dxt-ai.example/booking' },
    );
    expect(
      decideSite(
        site([monitor(clean, { carry: heldSsl, expiry: fact('2026-10-06', null) }), key], { open: sslOpen }),
      ),
    ).toMatchObject({ kind: 'new_cause', monitorId: 'booking' });
  });

  it.each<[string, OpenIncident, StoredCheck[], ExpiryFact]>([
    ['the expiry itself again', sslOpen, clean, fact('2026-10-06', null)],
    ['SSL → domain is no new cause', sslOpen, clean, fact('2026-12-22', '2026-10-13')],
    [
      'an incident open for another trigger',
      { ...sslOpen, trigger: 'slow' },
      forbidden,
      fact('2026-10-06', null),
    ],
  ])('%s → none', (_name, o, checks, expiry) => {
    expect(decideSite(site([monitor(checks, { carry: heldSsl, expiry })], { open: o }))).toMatchObject({
      kind: 'none',
    });
  });

  it('a DOWN still escalates (D-021), never a new cause', () => {
    expect(
      decideSite(
        site([monitor(failed(), { carry: heldSsl, expiry: fact('2026-10-06', null) })], { open: sslOpen }),
      ),
    ).toMatchObject({ kind: 'escalate' });
  });
});
