import { describe, expect, it } from 'vitest';
import {
  buildAcknowledgedAlert,
  buildDownAlert,
  buildRecoveredAlert,
  type ChatMessage,
  type DownAlertInput,
} from './chat-alerts';
import { formatCause } from './cause';

// ChatAlert board sample (test data only): MuvMi, INC-0142, confirmed down 09:48:41, back 10:31.
const confirmedAt = new Date('2026-09-25T02:48:41Z');
const arm = { name: 'Arm', chatUserId: 'ARM' };
const ploy = { name: 'Ploy', chatUserId: 'PLOY' };

const down = (over: Partial<DownAlertInput> = {}): ChatMessage =>
  buildDownAlert({
    incidentId: 'inc-1',
    incidentNumber: 142,
    site: 'MuvMi',
    tier: 1,
    confirmedAt,
    now: new Date('2026-09-25T02:49:30Z'),
    cause: 'Timeout > 30 s (BKK, TYO) · HTTP 504 (SIN)',
    confirmingLocations: 3,
    owner: arm,
    backup: ploy,
    incidentUrl: 'https://monitor.example.test/incidents/inc-1',
    ...over,
  });

const widgets = (m: ChatMessage) => m.cardsV2[0]!.card.sections[0]!.widgets;
const rows = (m: ChatMessage) =>
  widgets(m).flatMap((w) => ('decoratedText' in w ? [[w.decoratedText.topLabel, w.decoratedText.text]] : []));

describe('DOWN alert (ChatAlert, D-013)', () => {
  it('opens the text line with the mention, then DOWN · site (Tier) — no escalation promise yet', () => {
    expect(down().text).toBe('<users/ARM> DOWN · MuvMi (Tier 1)');
  });

  it('has the board header and subtitle', () => {
    expect(down().cardsV2[0]!.card.header).toEqual({
      title: 'DOWN · MuvMi',
      subtitle: 'Tier 1 · INC-0142 · Confirmed down 09:48:41 (UTC+7)',
    });
  });

  it('adds the date when DOWN was confirmed on another day', () => {
    const m = down({ now: new Date('2026-09-26T03:00:00Z') });
    expect(m.cardsV2[0]!.card.header.subtitle).toBe(
      'Tier 1 · INC-0142 · Fri 25 Sep · Confirmed down 09:48:41 (UTC+7)',
    );
  });

  it('behind a WAF, "Confirmed by" says who confirmed it and who was blocked (D-027)', () => {
    const m = down({ confirmingLocations: 1, confirmedByWaf: { from: ['BKK'], blocked: ['SIN', 'TYO'] } });
    expect(rows(m)).toContainEqual([
      'Confirmed by',
      'BKK only, 2 checks — SIN, TYO blocked by bot protection',
    ]);
  });

  it('lists cause, confirmation and owners — no "Next" row until S10', () => {
    expect(rows(down())).toEqual([
      ['Cause', 'Timeout > 30 s (BKK, TYO) · HTTP 504 (SIN)'],
      ['Confirmed by', '3 locations, 2 checks'],
      ['Owner', 'Arm · backup Ploy'],
    ]);
  });

  it('links "Open / acknowledge" (S02b) and says the ack is personal (spec §14.10)', () => {
    const url = 'https://monitor.example.test/incidents/inc-1?ack=1';
    expect(widgets(down({ incidentUrl: url }))).toContainEqual({
      buttonList: { buttons: [{ text: 'Open / acknowledge', onClick: { openLink: { url } } }] },
    });
    expect(widgets(down())).toContainEqual({
      textParagraph: {
        text:
          '<b>Current status is in the latest reply.</b><br>Anyone can open it; the ack is recorded ' +
          'under their own Google account, so nobody can acknowledge as someone else.',
      },
    });
  });

  it('mentions nobody without a Chat id, and says when no owner is set', () => {
    expect(down({ owner: { name: 'Arm', chatUserId: null } }).text).toBe('DOWN · MuvMi (Tier 1)');
    const m = down({ owner: null, backup: null });
    expect(m.text).toBe('DOWN · MuvMi (Tier 1)');
    expect(rows(m)).toContainEqual(['Owner', 'No owner set']);
    expect(rows(down({ backup: null }))).toContainEqual(['Owner', 'Arm']);
    expect(rows(down({ owner: null }))).toContainEqual(['Owner', 'No owner set · backup Ploy']);
  });

  it('strips angle brackets from names so nobody can inject a mention or a link', () => {
    const m = down({ site: 'Evil <users/all>', owner: { name: '<a href="x">Arm</a>', chatUserId: null } });
    expect(m.text).toBe('DOWN · Evil users/all (Tier 1)');
    expect(JSON.stringify(m)).not.toMatch(/<users|<a /);
  });

  it('never puts a mention inside the card', () => {
    expect(JSON.stringify(down().cardsV2)).not.toContain('<users/');
  });
});

describe('ACKNOWLEDGED reply (ChatAlert, D-016)', () => {
  const ack = buildAcknowledgedAlert({
    incidentId: 'inc-1',
    site: 'MuvMi',
    ackedBy: 'Arm',
    ackedAt: new Date('2026-09-25T03:07:40Z'),
  });

  it('has the board text line, with no mention', () => {
    expect(ack.text).toBe('ACKNOWLEDGED · MuvMi · by Arm 10:07');
  });

  it('has the board title, says only who acknowledged until escalation exists, and no button', () => {
    expect(ack.cardsV2[0]!.card.header.title).toBe('ACKNOWLEDGED · MuvMi still down · by Arm 10:07');
    expect(widgets(ack)).toEqual([{ textParagraph: { text: 'Acknowledged by Arm.' } }]);
  });

  it('strips angle brackets from the name', () => {
    const m = buildAcknowledgedAlert({
      incidentId: 'i',
      site: 'S',
      ackedBy: '<users/all>',
      ackedAt: new Date(),
    });
    expect(JSON.stringify(m)).not.toContain('<users');
  });
});

describe('RECOVERED reply (ChatAlert, spec §16.4)', () => {
  const recovered = buildRecoveredAlert({
    incidentId: 'inc-1',
    site: 'MuvMi',
    startedAt: confirmedAt,
    recoveredAt: new Date('2026-09-25T03:31:41Z'),
    okLocations: 3,
    owner: arm,
  });

  it('has the board text line', () => {
    expect(recovered.text).toBe('<users/ARM> RECOVERED · MuvMi · down 43 min · add a root cause');
  });

  it('has the board title and body, and no button', () => {
    expect(recovered.cardsV2[0]!.card.header.title).toBe(
      'RECOVERED · MuvMi is back · down 43 min (09:48–10:31)',
    );
    expect(widgets(recovered)).toEqual([
      { textParagraph: { text: 'OK from 3 locations. Needs a root cause before it can be resolved.' } },
    ]);
  });
});

describe('RECOVERED duration matches the range shown', () => {
  const recovered = (start: string, end: string) =>
    buildRecoveredAlert({
      incidentId: 'inc-1',
      site: 'MuvMi',
      startedAt: new Date(start),
      recoveredAt: new Date(end),
      okLocations: 2,
      owner: null,
    });

  it('counts clock minutes: 19:37:30 → 19:42:00 reads 5 min (19:37–19:42)', () => {
    const m = recovered('2026-10-06T12:37:30Z', '2026-10-06T12:42:00Z');
    expect(m.text).toBe('RECOVERED · MuvMi · down 5 min · add a root cause');
    expect(m.cardsV2[0]!.card.header.title).toBe('RECOVERED · MuvMi is back · down 5 min (19:37–19:42)');
  });

  it('names both days when the outage crosses midnight in Bangkok', () => {
    const m = recovered('2026-10-06T16:50:00Z', '2026-10-06T17:20:00Z');
    expect(m.cardsV2[0]!.card.header.title).toBe(
      'RECOVERED · MuvMi is back · down 30 min (Tue 6 Oct 23:50–Wed 7 Oct 00:20)',
    );
  });
});

describe('RECOVERED duration floor', () => {
  it('never says "down 0 min"', () => {
    const quick = buildRecoveredAlert({
      incidentId: 'inc-1',
      site: 'MuvMi',
      startedAt: confirmedAt,
      recoveredAt: new Date(confirmedAt.getTime() + 40_000),
      okLocations: 2,
      owner: null,
    });
    expect(quick.text).toBe('RECOVERED · MuvMi · down 1 min · add a root cause');
  });
});

describe('formatCause (spec §10)', () => {
  it('groups by kind with locations in BKK / SIN / TYO order', () => {
    expect(
      formatCause(
        [
          { location: 'TYO', statusCode: null, error: 'Timeout' },
          { location: 'SIN', statusCode: 504, error: null },
          { location: 'BKK', statusCode: null, error: 'Timeout' },
        ],
        30_000,
      ),
    ).toBe('Timeout > 30 s (BKK, TYO) · HTTP 504 (SIN)');
  });

  it.each([
    ['ENOTFOUND', 'DNS error (SIN)'],
    ['EAI_AGAIN', 'DNS error (SIN)'],
    ['ECONNREFUSED', 'Connection refused (SIN)'],
    ['ECONNRESET', 'Connection reset (SIN)'],
    ['CERT_HAS_EXPIRED', 'TLS error (SIN)'],
    ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'TLS error (SIN)'],
    ['something odd with secrets', 'Connection error (SIN)'],
    [null, 'Connection error (SIN)'],
  ])('%s → %s', (error, expected) => {
    expect(formatCause([{ location: 'SIN', statusCode: null, error }], 10_000)).toBe(expected);
  });

  it('uses the monitor timeout', () => {
    expect(formatCause([{ location: 'SIN', statusCode: null, error: 'Timeout' }], 10_000)).toBe(
      'Timeout > 10 s (SIN)',
    );
  });
});

describe('card rows are plain text (security review S03 M2)', () => {
  it('escapes markup in a cause reported by a probe or the VPS', () => {
    const card = JSON.stringify(
      buildDownAlert({
        incidentId: 'i1',
        site: 'Test target',
        tier: 1,
        incidentNumber: 7,
        incidentUrl: 'https://monitor.example.test/incidents/i1',
        confirmedAt: new Date('2026-10-07T03:00:40Z'),
        now: new Date('2026-10-07T03:00:41Z'),
        cause: 'Browser: page didn’t load (<a href="https://phish.example">Open incident</a>)',
        confirmingLocations: 2,
        owner: null,
        backup: null,
      }),
    );
    expect(card).not.toContain('<a href');
    expect(card).toContain('Browser: page didn’t load (&lt;a href=');
  });
});
