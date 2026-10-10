import { describe, expect, it } from 'vitest';
import { buildResolvedEmail } from './email-alerts';
import { buildNoteAlert, buildResolvedAlert, plainText, resolvedLasted } from './resolve-alerts';

// ChatAlert board rows "Note" and "Resolved" (spec §16.5, D-033).
describe('NOTE reply', () => {
  it('is the board text line, mentions nobody, no card', () => {
    const m = buildNoteAlert({
      site: 'MuvMi',
      by: 'Arm',
      text: 'origin timing out behind the CDN, restarting the app server',
    });
    expect(m).toEqual({
      text: 'NOTE · MuvMi · Arm: origin timing out behind the CDN, restarting the app server',
      cardsV2: [],
    });
  });
  it('a note can’t mention anyone or make a link; ">" and line breaks read as written', () => {
    const m = buildNoteAlert({
      site: 'MuvMi',
      by: '<users/all>',
      text: 'ping <users/all> and <https://x|here>\nTimeout > 30 s',
    });
    expect(m.text).not.toMatch(/<users|<https/);
    expect(m.text).toBe('NOTE · MuvMi · users/all: ping ‹users/all> and ‹https://x|here> Timeout > 30 s');
    expect(plainText('  a\n\n b ')).toBe('a b');
  });
});

const resolved = {
  incidentId: 'inc-139',
  site: 'ORCA Thailand',
  resolvedBy: 'Tao',
  resolvedAt: new Date('2026-09-25T03:08:00Z'),
  rootCause: 'Hosting / server',
  whatHappened: 'Host rebooted the app server without notice',
  whatFixedIt: 'Nothing from our side — provider reboot finished',
  drops: [{ start: new Date('2026-09-24T15:14:00Z'), end: new Date('2026-09-24T15:22:00Z') }],
};

describe('RESOLVED reply', () => {
  it('has the board text line, no mention, and a card with the root cause', () => {
    const m = buildResolvedAlert(resolved);
    expect(m.text).toBe('RESOLVED · ORCA Thailand · by Tao 10:08');
    expect(m.cardsV2[0]!.card.header.title).toBe('Root cause · Hosting / server');
    expect(m.cardsV2[0]!.card.sections[0]!.widgets).toEqual([
      {
        decoratedText: {
          topLabel: 'What happened',
          text: 'Host rebooted the app server without notice',
          wrapText: true,
        },
      },
      {
        decoratedText: {
          topLabel: 'What fixed it',
          text: 'Nothing from our side — provider reboot finished',
          wrapText: true,
        },
      },
      { decoratedText: { topLabel: 'Down for', text: '8 min (22:14–22:22)', wrapText: true } },
    ]);
  });
  it('people’s words can’t put tags in the card or the line', () => {
    const m = buildResolvedAlert({
      ...resolved,
      resolvedBy: '<b>Tao</b>',
      whatHappened: '<users/all> <a href=x>y</a>',
      whatFixedIt: null,
    });
    expect(JSON.stringify(m)).not.toMatch(/<users|<a |<b>/);
  });
});

describe('RESOLVED email', () => {
  const m = buildResolvedEmail({
    ...resolved,
    incidentNumber: 139,
    tier: 2,
    recipientId: 'u-nok',
    reason: 'emailed',
    incidentUrl: 'https://monitor.example.test/incidents/inc-139',
    threadId: '<inc-inc-139@notify.example.test>',
    startsThread: false,
  });
  it('goes in the incident thread with who resolved it and the root cause', () => {
    expect(m.subject).toBe('ORCA Thailand · Tier 2 · INC-0139');
    expect(m.headers).toEqual({
      'In-Reply-To': '<inc-inc-139@notify.example.test>',
      References: '<inc-inc-139@notify.example.test>',
    });
    expect(m.text).toContain(
      [
        'RESOLVED — ORCA Thailand is resolved',
        'Resolved by Tao at 10:08. Nothing needed from you.',
        '',
        'Root cause: Hosting / server',
        'What happened: Host rebooted the app server without notice',
        'What fixed it: Nothing from our side — provider reboot finished',
        'Down for: 8 min (22:14–22:22)',
      ].join('\n'),
    );
    expect(m.text).toContain('You got this because you were emailed about this incident.');
  });
  it('escapes people’s words in the HTML', () => {
    const e = buildResolvedEmail({
      ...resolved,
      whatHappened: '<script>x</script>',
      incidentNumber: 1,
      tier: 1,
      recipientId: 'u',
      reason: 'owner',
      incidentUrl: 'https://x.test/i',
      threadId: '<t@x>',
      startsThread: true,
    });
    expect(e.html).not.toContain('<script>');
    expect(e.html).toContain('&lt;script&gt;');
  });
});

describe('resolvedLasted — DOWN minutes only (message-checker H1, D-033)', () => {
  const d = (from: string, to: string, severity?: 'down' | 'problem') => ({
    start: new Date(`2026-09-20T${from}:00+07:00`),
    end: new Date(`2026-09-20T${to}:00+07:00`),
    ...(severity ? { severity } : {}),
  });
  it.each([
    ['one DOWN drop', [d('09:48', '10:31')], ['Down for', '43 min (09:48–10:31)']],
    [
      'VOCA, flapped: DOWN minutes in total over the span',
      [d('03:12', '03:19'), d('03:24', '03:35'), d('03:38', '03:52'), d('03:55', '04:04')],
      ['Down in total', '41 min (03:12–04:04)'],
    ],
    [
      'D-021: the PROBLEM before the outage isn’t down',
      [d('03:00', '03:10', 'problem'), d('03:10', '03:15', 'down')],
      ['Down for', '5 min (03:10–03:15)'],
    ],
    ['a PROBLEM only', [d('09:52', '10:14', 'problem')], ['Problem lasted', '22 min (09:52–10:14)']],
    ['never recovered (none closed)', [], null],
  ])('%s', (_n, drops, expected) => {
    expect(resolvedLasted(drops)).toEqual(expected);
  });
});
