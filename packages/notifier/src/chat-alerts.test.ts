import { describe, expect, it } from 'vitest';
import { buildDownAlert, buildRecoveredAlert, type ChatMessage, type DownAlertInput } from './chat-alerts';
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

  it('lists cause, confirmation and owners — no "Next" row until S10', () => {
    expect(rows(down())).toEqual([
      ['Cause', 'Timeout > 30 s (BKK, TYO) · HTTP 504 (SIN)'],
      ['Confirmed by', '3 locations, 2 checks'],
      ['Owner', 'Arm · backup Ploy'],
    ]);
  });

  it('links "Open incident" and keeps the footer', () => {
    expect(widgets(down())).toContainEqual({
      buttonList: {
        buttons: [
          {
            text: 'Open incident',
            onClick: { openLink: { url: 'https://monitor.example.test/incidents/inc-1' } },
          },
        ],
      },
    });
    expect(widgets(down())).toContainEqual({
      textParagraph: { text: '<b>Current status is in the latest reply.</b>' },
    });
  });

  it('mentions nobody without a Chat id, and says when no owner is set', () => {
    expect(down({ owner: { name: 'Arm', chatUserId: null } }).text).toBe('DOWN · MuvMi (Tier 1)');
    const m = down({ owner: null, backup: null });
    expect(m.text).toBe('DOWN · MuvMi (Tier 1)');
    expect(rows(m)).toContainEqual(['Owner', 'No owner set']);
    expect(rows(down({ backup: null }))).toContainEqual(['Owner', 'Arm']);
  });

  it('never puts a mention inside the card', () => {
    expect(JSON.stringify(down().cardsV2)).not.toContain('<users/');
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
