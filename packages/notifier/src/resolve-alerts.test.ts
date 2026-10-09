import { describe, expect, it } from 'vitest';
import { buildResolvedEmail } from './email-alerts';
import { buildNoteAlert, buildResolvedAlert, plainText } from './resolve-alerts';

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
  severity: 'down' as const,
  startedAt: new Date('2026-09-24T15:14:00Z'),
  recoveredAt: new Date('2026-09-24T15:22:00Z'),
};

describe('RESOLVED reply', () => {
  it('has the board text line, no mention, and a card with the root cause', () => {
    const m = buildResolvedAlert(resolved);
    expect(m.text).toBe('RESOLVED · ORCA Thailand · by Tao 10:08');
    expect(m.cardsV2[0]!.card.header.title).toBe('RESOLVED · ORCA Thailand · by Tao 10:08');
    expect(m.cardsV2[0]!.card.sections[0]!.widgets).toEqual([
      { decoratedText: { topLabel: 'Root cause', text: 'Hosting / server', wrapText: true } },
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
