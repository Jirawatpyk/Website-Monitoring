import { describe, expect, it } from 'vitest';
import { buildClientUpdateDueAlert, clientUpdateDraft } from './client-update-alerts';
import {
  buildAcknowledgedEmail,
  buildClientUpdateDueEmail,
  buildRecoveredEmail,
  buildStepEmail,
} from './email-alerts';

describe('the client-update rows on later emails (EmailAlert Bua rows, S11)', () => {
  const at = (iso: string) => new Date(`${iso}+07:00`);
  const base = {
    incidentId: 'i142',
    incidentNumber: 142,
    site: 'MuvMi',
    tier: 1,
    recipientId: 'bua',
    reason: 'step' as const,
    why: 'You got this because you were emailed about the client update at 10:03.',
    incidentUrl: 'https://monitor.example.test/incidents/i142',
    threadId: '<inc-i142@notify.example.test>',
    startsThread: false,
  };
  const draftUrl = 'https://monitor.example.test/incidents/i142#client-update';
  const ack = (over: Partial<Parameters<typeof buildAcknowledgedEmail>[0]> = {}) =>
    buildAcknowledgedEmail({
      ...base,
      ackedBy: 'Arm',
      ackedAt: at('2026-09-25T10:07:40'),
      startedAt: at('2026-09-25T09:48:12'),
      confirmedAt: at('2026-09-25T09:48:41'),
      ...over,
    });
  const recovered = (over: Partial<Parameters<typeof buildRecoveredEmail>[0]> = {}) =>
    buildRecoveredEmail({
      ...base,
      startedAt: at('2026-09-25T09:48:12'),
      recoveredAt: at('2026-09-25T10:31:00'),
      okLocations: 3,
      owner: 'Arm',
      ack: null,
      ...over,
    });

  it('ACKNOWLEDGED: still yours + Open draft while waiting; one button once marked; none of it for a PROBLEM', () => {
    const waiting = ack({
      amReader: { marked: null, draftUrl },
      clientUpdate: 'Due 10:03 · Bua (AM) notified',
    });
    expect(waiting.text).toContain('The client update is still yours to send.');
    expect(waiting.text).toContain(`Open draft: ${draftUrl}`);
    const marked = ack({ amReader: { marked: '10:12', draftUrl } });
    expect(marked.text).not.toContain('still yours');
    expect(marked.text).not.toContain('Open draft');
    const problem = ack({ amReader: { marked: null, draftUrl }, problem: { trigger: 'slow' } });
    expect(problem.text).not.toContain('Open draft');
  });

  it('RECOVERED: marked / not yet; Still to do names the AM, or "the AM"; no owner', () => {
    expect(
      recovered({
        amReader: { marked: '10:12', draftUrl },
        clientUpdate: 'Marked by Bua 10:12',
        amName: 'Bua',
      }).text,
    ).toContain('your 10:12 update is already on record');
    const pending = recovered({ amReader: { marked: null, draftUrl }, clientUpdate: 'Due 10:03' });
    expect(pending.text).toContain('mark the client update on the incident page');
    // No AM name given: no "tell the client" item (message-check L3).
    expect(pending.text).toContain('Still to do: Root cause (Arm)\n');
    expect(recovered({ owner: null, clientUpdate: 'Due 10:03', amName: 'Bua' }).text).toContain(
      'Still to do: tell the client it’s back (Bua)',
    );
    expect(recovered({ owner: null }).text).not.toContain('Still to do');
  });

  it('RECOVERED to the AM: "not needed" said as such; no AM → no "tell the client" item; the owner first', () => {
    const nn = recovered({
      owner: null,
      amReader: { marked: '10:07', notNeeded: 'Tao 10:07', draftUrl },
      clientUpdate: 'Not needed · Tao 10:07',
      amName: 'Bua',
    });
    expect(nn.text).toContain('The client update was marked not needed (Tao 10:07)');
    expect(nn.text).not.toContain('already on record');
    expect(nn.text).not.toContain('Still to do');
    expect(recovered({ clientUpdate: 'Due 10:03 · no AM, the Admins were told' }).text).toContain(
      'Still to do: Root cause (Arm)\n',
    );
    const ownerAm = recovered({
      reason: 'owner',
      amReader: { marked: '10:12', draftUrl },
      clientUpdate: 'x',
      amName: 'Arm',
    });
    expect(ownerAm.text).toContain('Needs a root cause before it can be resolved.');
    // The AM's single "Open incident" is primary (EmailAlert Bua RECOVERED).
    expect(recovered({ owner: null, amReader: { marked: '10:12', draftUrl } }).html).toContain(
      'font-weight:600;font-size:14px;line-height:18px;text-decoration:none">Open incident',
    );
  });

  it('the due email: the day on a confirmed time from another day; "was down" in the recovery minute', () => {
    const m = buildClientUpdateDueEmail({
      ...base,
      tier: 2,
      client: 'ORCA',
      confirmedAt: at('2026-09-24T22:14:30'),
      dueAt: at('2026-09-25T10:00:00'),
      downMinutes: 706,
      cause: null,
      acked: null,
      noAm: false,
      draftUrl,
      recovered: true,
    });
    expect(m.text).toContain('was down 60 min inside response hours');
    expect(m.text).toMatch(/confirmed down Thu 24 Sep 22:14:30/);
    expect(m.text).not.toContain('Cause:');
  });

  it('the L3 FYI carries the row', () => {
    const m = buildStepEmail({
      ...base,
      severity: 'down',
      level: 3,
      elapsedMin: 60,
      confirmedAt: at('2026-09-25T09:48:41'),
      owner: 'Arm',
      asFyi: false,
      asked: 'CEO and Bua',
      cause: null,
      kind: 'fyi',
      acked: { by: 'Arm', at: at('2026-09-25T10:07:40') },
      clientUpdate: 'Marked by Bua 10:12 — “Called MuvMi ops, ETA shared”',
    } as Parameters<typeof buildStepEmail>[0]);
    expect(m.text).toContain('Client update: Marked by Bua 10:12 — “Called MuvMi ops, ETA shared”');
  });
});

const bkk = (iso: string) => new Date(`${iso}+07:00`);
const bua = { name: 'Bua', chatUserId: 'BUA' };
const tao = { name: 'Tao', chatUserId: 'TAO' };
const url = 'https://monitor.example.test/incidents/i142';
const draftUrl = `${url}#client-update`;

describe('CLIENT UPDATE DUE in the thread (ChatAlert 10:03, S11)', () => {
  const alert = (over: Partial<Parameters<typeof buildClientUpdateDueAlert>[0]> = {}) =>
    buildClientUpdateDueAlert({
      incidentId: 'i142',
      site: 'MuvMi',
      tier: 1,
      people: [bua],
      noAm: false,
      client: 'MuvMi',
      recovered: false,
      draftUrl,
      ...over,
    });

  it('@mentions Bua in the text line; the card opens the draft', () => {
    const m = alert();
    expect(m.text).toBe('<users/BUA> CLIENT UPDATE DUE · MuvMi DOWN 15 min · draft ready');
    const card = m.cardsV2[0]!.card;
    expect(card.header?.title).toBe('CLIENT UPDATE DUE · MuvMi still down · 15 min');
    expect(JSON.stringify(card)).toContain(
      'Bua (AM) sends the client message from the draft on the incident page, then marks it. Runs whether or not the incident is acknowledged.',
    );
    expect(JSON.stringify(card)).toContain(
      `"text":"Open draft","onClick":{"openLink":{"url":"${draftUrl}"}}`,
    );
  });

  it('Tier 2 says 60 min inside response hours; recovered in that minute says was down', () => {
    const m = alert({ tier: 2, recovered: true });
    expect(m.text).toBe(
      '<users/BUA> CLIENT UPDATE DUE · MuvMi DOWN 60 min inside response hours · draft ready',
    );
    expect(m.cardsV2[0]!.card.header?.title).toBe(
      'CLIENT UPDATE DUE · MuvMi was down · 60 min inside response hours',
    );
  });

  it('no AM: Tao (Admin) is @mentioned and the line says so (D-052 item 2)', () => {
    const m = alert({ people: [tao], noAm: true });
    expect(m.text).toBe(
      '<users/TAO> CLIENT UPDATE DUE · MuvMi DOWN 15 min · no account manager for MuvMi · draft ready',
    );
    expect(JSON.stringify(m.cardsV2)).toContain(
      'MuvMi has no account manager in DxT Monitor, so Tao (Admin) is told',
    );
  });

  it('an AM without a Chat id is named, since a mention can’t reach them', () => {
    expect(alert({ people: [{ name: 'Bua', chatUserId: null }] }).text).toBe(
      'CLIENT UPDATE DUE · MuvMi DOWN 15 min · for Bua · draft ready',
    );
  });
});

describe('The draft client message (Incident board)', () => {
  const since = bkk('2026-09-25T09:48:12');
  const now = bkk('2026-09-25T10:07:00');

  it('Thai, as the board', () => {
    expect(clientUpdateDraft({ client: 'MuvMi', since, am: 'Bua', lang: 'th', now })).toBe(
      'เรียนทีม MuvMi\nขณะนี้เว็บไซต์ของท่านไม่สามารถเข้าใช้งานได้ ตั้งแต่เวลา 09:48 น. ทีม DxT ตรวจพบแล้วและกำลังแก้ไข จะแจ้งความคืบหน้าภายใน [ETA] น.\nขออภัยในความไม่สะดวก — Bua, DxT Solutions',
    );
  });

  it('English, as the board', () => {
    expect(clientUpdateDraft({ client: 'MuvMi', since, am: 'Bua', lang: 'en', now })).toBe(
      'Hi MuvMi team,\nYour website has been unavailable since 09:48 (UTC+7). DxT detected it and is working on a fix. Next update by [ETA].\nSorry for the disruption — Bua, DxT Solutions',
    );
  });

  it('another day gets its day; no AM signs as DxT Solutions', () => {
    const text = clientUpdateDraft({
      client: 'MuvMi',
      since,
      am: null,
      lang: 'en',
      now: bkk('2026-09-26T08:00:00'),
    });
    expect(text).toContain('since Fri 25 Sep 09:48 (UTC+7)');
    expect(text).toContain('— DxT Solutions');
  });
});

describe('Client update due email (EmailAlert "Client update")', () => {
  const email = (over: Partial<Parameters<typeof buildClientUpdateDueEmail>[0]> = {}) =>
    buildClientUpdateDueEmail({
      incidentId: 'i142',
      incidentNumber: 142,
      site: 'MuvMi',
      tier: 1,
      recipientId: 'bua',
      reason: 'step',
      incidentUrl: url,
      threadId: '<inc-i142@notify.example.test>',
      startsThread: true,
      client: 'MuvMi',
      confirmedAt: bkk('2026-09-25T09:48:41'),
      downMinutes: 15,
      cause: 'Timeout > 30 s (BKK, TYO) · HTTP 504 (SIN)',
      acked: null,
      noAm: false,
      draftUrl,
      ...over,
    });

  it('subject, preheader, facts, Open draft first, the AM footer', () => {
    const m = email();
    expect(m.subject).toBe('MuvMi · Tier 1 · INC-0142');
    expect(m.text).toContain('CLIENT UPDATE DUE — Tell MuvMi what’s happening');
    expect(m.html).toContain('CLIENT UPDATE DUE — MuvMi down 15 min · draft ready');
    expect(m.text).toContain(
      'MuvMi (Tier 1) has been down 15 min. Please update the client and mark it on the incident page — the incident can’t be resolved until you do.',
    );
    expect(m.text).toContain('Down for: 15 min (confirmed down 09:48:41)');
    expect(m.text).toContain('Cause: Timeout > 30 s (BKK, TYO) · HTTP 504 (SIN)');
    expect(m.text).toContain('Draft: Ready on the incident page — edit, send it to the client, then mark it');
    expect(m.text).toContain('Acknowledged: Not yet');
    expect(m.text.indexOf('Open draft:')).toBeLessThan(m.text.indexOf('Open incident:'));
    expect(m.text).toContain(
      'You got this because you’re the AM for MuvMi and a Tier 1 site was down 15 min.',
    );
  });

  it('acked, Tier 2, and the Admin footer with no AM', () => {
    const m = email({
      tier: 2,
      acked: { by: 'Arm', at: bkk('2026-09-25T10:07:40') },
      noAm: true,
      downMinutes: 60,
    });
    expect(m.text).toContain('Acknowledged: Arm at 10:07');
    expect(m.text).toContain('has been down 60 min inside response hours');
    expect(m.text).toContain(
      'You got this because you’re an Admin and MuvMi has no account manager in DxT Monitor.',
    );
  });
});
