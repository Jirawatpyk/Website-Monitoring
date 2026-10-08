import { describe, expect, it } from 'vitest';
import {
  buildAcknowledgedAlert,
  buildProblemAlert,
  buildRecoveredAlert,
  type ChatWidget,
  type ProblemAlertInput,
} from './chat-alerts';
import {
  buildAcknowledgedEmail,
  buildProblemEmail,
  buildRecoveredEmail,
  type EmailBaseInput,
} from './email-alerts';

// ChatAlert / EmailAlert PROBLEM thread (spec §19, D-022) — board sample, test data only: INC-0141
// Fuji Links (Tier 2), slow p50 5.8 s, detected Fri 25 Sep 09:52, acked by Ploy 09:58, back 10:14;
// INC-0138 Tubtong blocked, not verified, Thu 24 Sep 14:02.
const detectedAt = new Date('2026-09-25T02:52:00Z');
const CAUSE = 'p50 5.8 s (BKK, SIN, TYO) · over the Tier 2 limit of 5 s for 3 checks in a row';
const fuji: ProblemAlertInput = {
  incidentId: 'inc-141',
  incidentNumber: 141,
  site: 'Fuji Links',
  tier: 2,
  trigger: 'slow',
  detectedAt,
  now: new Date('2026-09-25T02:52:05Z'),
  cause: CAUSE,
  summary: 'slow, p50 5.8 s',
  seenFrom: { count: 3, of: 3 },
  owner: { name: 'Ploy', chatUserId: 'PLOY' },
  backup: { name: 'Nok', chatUserId: 'NOK' },
  incidentUrl: 'https://monitor.example.test/incidents/inc-141?ack=1',
};
const rows = (widgets: ChatWidget[]) =>
  widgets.flatMap((w) => ('decoratedText' in w ? [[w.decoratedText.topLabel, w.decoratedText.text]] : []));

describe('PROBLEM first card (ChatAlert)', () => {
  it('INC-0141: the board text line, mentioning only the owner', () => {
    expect(buildProblemAlert(fuji).text).toBe(
      '<users/PLOY> PROBLEM · Fuji Links (Tier 2) · slow, p50 5.8 s · please take a look',
    );
  });

  it('the board header, subtitle and rows — no "Next" row or "(not notified yet)" until S08 (D-013)', () => {
    const { card } = buildProblemAlert(fuji).cardsV2[0]!;
    expect(card.header).toEqual({
      title: 'PROBLEM · Fuji Links',
      subtitle: 'Tier 2 · INC-0141 · Detected 09:52 (UTC+7)',
    });
    const widgets = card.sections[0]!.widgets;
    expect(rows(widgets)).toEqual([
      ['Trigger', 'Slow'],
      ['Cause', CAUSE],
      ['Seen from', '3 of 3 locations — the site loads, just slowly'],
      ['Owner', 'Ploy · backup Nok'],
    ]);
    expect(widgets).toContainEqual({
      buttonList: {
        buttons: [{ text: 'Open / acknowledge', onClick: { openLink: { url: fuji.incidentUrl } } }],
      },
    });
    expect(JSON.stringify(card)).not.toContain('<users/');
  });

  it('INC-0138 Tubtong: PROBLEM (unverified) says what we know, and that the Admin is told separately', () => {
    const m = buildProblemAlert({
      ...fuji,
      incidentId: 'inc-138',
      incidentNumber: 138,
      site: 'Tubtong',
      trigger: 'blocked_unverified',
      detectedAt: new Date('2026-09-24T07:02:00Z'),
      cause: 'HTTP 403 bot challenge (BKK, SIN, TYO) · browser verifier unavailable',
      summary: 'blocked by bot protection, not verified',
      verifier: 'not_picked_up',
    });
    expect(m.text).toBe(
      '<users/PLOY> PROBLEM · Tubtong (Tier 2) · blocked by bot protection, not verified · please take a look',
    );
    const { card } = m.cardsV2[0]!;
    expect(card.header).toEqual({
      title: 'PROBLEM · Tubtong · not verified',
      subtitle: 'Tier 2 · INC-0138 · Thu 24 Sep · Detected 14:02 (UTC+7)',
    });
    expect(rows(card.sections[0]!.widgets)).toEqual([
      ['Trigger', 'Blocked, not verified'],
      ['Cause', 'HTTP 403 bot challenge (BKK, SIN, TYO) · browser verifier unavailable'],
      [
        'What we know',
        'No proof either way — the site may be fine. Checked again every round: OK with a note once the verifier loads the page, DOWN if the page fails.',
      ],
      ['Owner', 'Ploy · backup Nok'],
    ]);
    expect(JSON.stringify(card)).toContain('The Admin is told about the verifier separately (system email).');
    // Blocked in the browser too: the verifier works, so no Admin email to mention (D-020).
    const blocked = buildProblemAlert({
      ...fuji,
      trigger: 'blocked_unverified',
      verifier: 'browser_blocked',
    });
    expect(JSON.stringify(blocked.cardsV2)).not.toContain('Admin is told');
    // Behind a WAF with the VPS's control check down: the Admin is told about the BKK network (D-028).
    const control = buildProblemAlert({ ...fuji, trigger: 'blocked_unverified', verifier: 'control_failed' });
    expect(JSON.stringify(control.cardsV2)).toContain(
      'The Admin is told about the BKK probe’s network separately',
    );
    expect(JSON.stringify(control.cardsV2)).not.toContain('about the verifier');
    // …and the verifier is never asked: the card says what clears it instead.
    expect(JSON.stringify(control.cardsV2)).toContain('decided from BKK once its network check passes');
    expect(JSON.stringify(control.cardsV2)).not.toContain('once the verifier loads the page');
  });

  it('a TLS chain PROBLEM shows its label (D-029)', () => {
    const m = buildProblemAlert({
      ...fuji,
      trigger: 'tls_chain',
      cause: 'TLS chain misconfigured (BKK, SIN, TYO) · most browsers open it, apps and API clients fail',
      summary: 'TLS chain misconfigured',
    });
    expect(JSON.stringify(m.cardsV2)).toContain('TLS chain');
    expect(m.text).toContain('TLS chain misconfigured');
  });

  it('another trigger shows where it was seen, without the slow note; no owner, no mention', () => {
    const m = buildProblemAlert({
      ...fuji,
      trigger: 'keyword',
      seenFrom: { count: 2, of: 3 },
      owner: null,
      backup: null,
    });
    expect(m.text).toBe('PROBLEM · Fuji Links (Tier 2) · slow, p50 5.8 s · please take a look');
    expect(rows(m.cardsV2[0]!.card.sections[0]!.widgets)).toContainEqual(['Seen from', '2 of 3 locations']);
    expect(rows(m.cardsV2[0]!.card.sections[0]!.widgets)).toContainEqual(['Owner', 'No owner set']);
    expect(
      rows(buildProblemAlert({ ...fuji, seenFrom: null }).cardsV2[0]!.card.sections[0]!.widgets),
    ).toHaveLength(3);
  });
});

describe('PROBLEM replies (ChatAlert)', () => {
  it('ACKNOWLEDGED: "still slow", the site is up — no "reminders stopped" until S08', () => {
    const m = buildAcknowledgedAlert({
      incidentId: 'inc-141',
      site: 'Fuji Links',
      ackedBy: 'Ploy',
      ackedAt: new Date('2026-09-25T02:58:12Z'),
      problem: { trigger: 'slow' },
    });
    expect(m.text).toBe('ACKNOWLEDGED · Fuji Links · by Ploy 09:58');
    expect(m.cardsV2[0]!.card.header.title).toBe('ACKNOWLEDGED · Fuji Links still slow · by Ploy 09:58');
    expect(JSON.stringify(m.cardsV2)).toContain('Acknowledged by Ploy. The site is up; it’s only slow.');
    const other = buildAcknowledgedAlert({
      incidentId: 'i',
      site: 'X',
      ackedBy: 'Ploy',
      ackedAt: new Date('2026-09-25T02:58:12Z'),
      problem: { trigger: 'keyword' },
    });
    expect(other.cardsV2[0]!.card.header.title).toBe('ACKNOWLEDGED · X still has a problem · by Ploy 09:58');
  });

  it('RECOVERED: "problem cleared after 22 min", back under the limit', () => {
    const m = buildRecoveredAlert({
      incidentId: 'inc-141',
      site: 'Fuji Links',
      startedAt: detectedAt,
      recoveredAt: new Date('2026-09-25T03:14:00Z'),
      okLocations: 3,
      owner: { name: 'Ploy', chatUserId: 'PLOY' },
      problem: { trigger: 'slow', slowLimitMs: 5_000 },
    });
    expect(m.text).toBe(
      '<users/PLOY> RECOVERED · Fuji Links · problem cleared after 22 min · add a root cause',
    );
    expect(m.cardsV2[0]!.card.header.title).toBe(
      'RECOVERED · Fuji Links back to normal · slow for 22 min (09:52–10:14)',
    );
    expect(JSON.stringify(m.cardsV2)).toContain(
      'Response time back under 5 s from 3 locations. Needs a root cause before it can be resolved.',
    );
    const other = buildRecoveredAlert({
      incidentId: 'i',
      site: 'X',
      startedAt: detectedAt,
      recoveredAt: new Date('2026-09-25T03:14:00Z'),
      okLocations: 2,
      owner: null,
      problem: { trigger: 'regional' },
    });
    expect(other.cardsV2[0]!.card.header.title).toBe(
      'RECOVERED · X back to normal · problem for 22 min (09:52–10:14)',
    );
    expect(JSON.stringify(other.cardsV2)).toContain('OK from 2 locations.');
  });
});

describe('PROBLEM emails (EmailAlert PROBLEM thread)', () => {
  const base: EmailBaseInput = {
    incidentId: 'inc-141',
    incidentNumber: 141,
    site: 'Fuji Links',
    tier: 2,
    recipientId: 'u-ploy',
    reason: 'owner',
    incidentUrl: 'https://monitor.example.test/incidents/inc-141',
    threadId: '<inc-inc-141@notify.example.test>',
    startsThread: true,
  };

  it('PROBLEM to the owner: amber, its own subject, the status first', () => {
    const m = buildProblemEmail({
      ...base,
      trigger: 'slow',
      detectedAt,
      cause: CAUSE,
      summary: 'slow, p50 5.8 s',
    });
    expect(m.subject).toBe('Fuji Links · Tier 2 · INC-0141');
    expect(m.html).toContain('PROBLEM — Fuji Links · slow, p50 5.8 s · detected 09:52');
    expect(m.html).toContain('#b45309');
    expect(m.text).toMatch(/^PROBLEM — Fuji Links is slow/);
    expect(m.text).toContain(
      'The site is up but slow. You own Fuji Links — please take a look and acknowledge, or hand it over in the Chat thread.',
    );
    expect(m.text).toContain('Detected: Fri 25 Sep 09:52');
    expect(m.text).toContain('Trigger: Slow');
    expect(m.text).toContain(`Cause: ${CAUSE}`);
    expect(m.text).toContain('Site: Up — pages load, but slowly. Not an outage.');
    expect(m.text).toContain('Open / acknowledge: https://monitor.example.test/incidents/inc-141?ack=1');
    expect(m.text).toContain('You got this because you own Fuji Links.');
    expect(m.headers).toEqual({ References: '<inc-inc-141@notify.example.test>' });
  });

  it('words a misconfigured certificate chain (D-029)', () => {
    const m = buildProblemEmail({
      ...base,
      trigger: 'tls_chain',
      detectedAt,
      cause: 'c',
      summary: 'TLS chain misconfigured',
    });
    expect(m.text).toContain(
      'Site: Up in most browsers — apps and API clients can’t connect. Not an outage.',
    );
    expect(m.text).toContain('install the right intermediate certificate');
  });

  it('words the other triggers, and the fallback reader', () => {
    const unverified = buildProblemEmail({
      ...base,
      trigger: 'blocked_unverified',
      detectedAt,
      cause: 'c',
      summary: 's',
    });
    expect(unverified.text).toMatch(/^PROBLEM — Fuji Links can’t be verified/);
    expect(unverified.text).toContain('Site: Unknown — blocked by bot protection; no proof either way.');
    expect(unverified.text).toContain('couldn’t be checked in a browser');
    const control = buildProblemEmail({
      ...base,
      trigger: 'blocked_unverified',
      detectedAt,
      cause: 'c',
      summary: 's',
      verifier: 'control_failed',
    });
    expect(control.text).toContain(
      'The site is blocked by bot protection at SIN and TYO, and the BKK probe’s network check failed.',
    );
    expect(control.text).not.toContain('couldn’t be checked in a browser');
    const keyword = buildProblemEmail({
      ...base,
      reason: 'fallback',
      trigger: 'keyword',
      detectedAt,
      cause: 'c',
      summary: 's',
    });
    expect(keyword.text).toMatch(/^PROBLEM — Fuji Links has a problem/);
    expect(keyword.text).toContain(
      'The Google Chat alert couldn’t be delivered, so this email is the alert.',
    );
  });

  it('ACKNOWLEDGED and RECOVERED for a PROBLEM', () => {
    const ack = buildAcknowledgedEmail({
      ...base,
      startsThread: false,
      ackedBy: 'Ploy',
      ackedAt: new Date('2026-09-25T02:58:12Z'),
      startedAt: detectedAt,
      confirmedAt: detectedAt,
      problem: { trigger: 'slow' },
    });
    expect(ack.html).toContain('ACKNOWLEDGED — by Ploy 09:58 · Fuji Links still slow');
    expect(ack.text).toContain('The site is still up but slow; you’ll get one more email when it clears.');
    expect(ack.text).toContain('Slow for: 6 min so far (detected 09:52)');
    expect(
      buildAcknowledgedEmail({
        ...base,
        ackedBy: 'Ploy',
        ackedAt: new Date('2026-09-25T02:58:12Z'),
        startedAt: detectedAt,
        confirmedAt: detectedAt,
        problem: { trigger: 'slow' },
        cause: CAUSE,
      }).text,
    ).toContain(`Cause: ${CAUSE}`);
    const rec = buildRecoveredEmail({
      ...base,
      startsThread: false,
      startedAt: detectedAt,
      recoveredAt: new Date('2026-09-25T03:14:00Z'),
      okLocations: 3,
      owner: 'Ploy',
      ack: { by: 'Ploy', at: new Date('2026-09-25T02:58:12Z') },
      problem: { trigger: 'slow' },
    });
    expect(rec.text).toMatch(/^RECOVERED — Fuji Links is back to normal/);
    expect(rec.html).toContain(
      'RECOVERED — Fuji Links back to normal at 10:14 · problem lasted 22 min · root cause needed',
    );
    expect(rec.text).toContain('Problem lasted: 22 min (09:52–10:14)');
    expect(rec.text).toContain('Still to do: Root cause (Ploy) · a PROBLEM ends at Resolved — no review');
    const other = buildRecoveredEmail({
      ...base,
      reason: 'fallback',
      startedAt: detectedAt,
      recoveredAt: new Date('2026-09-25T03:14:00Z'),
      okLocations: 3,
      owner: null,
      ack: null,
      problem: { trigger: 'keyword' },
    });
    expect(other.text).toContain('The problem cleared. Nothing needed from you.');
    const ackOther = buildAcknowledgedEmail({
      ...base,
      ackedBy: 'Ploy',
      ackedAt: new Date('2026-09-25T02:58:12Z'),
      startedAt: detectedAt,
      confirmedAt: detectedAt,
      problem: { trigger: 'keyword' },
    });
    expect(ackOther.text).toContain('Problem for: 6 min so far');
  });
});
