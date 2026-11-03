import { describe, expect, it } from 'vitest';
import { buildClientUpdateDueAlert, clientUpdateDraft } from './client-update-alerts';
import { buildClientUpdateDueEmail } from './email-alerts';

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
    expect(m.text).toBe('<users/BUA> CLIENT UPDATE DUE · MuvMi · DOWN 15 min · draft ready');
    const card = m.cardsV2[0]!.card;
    expect(card.header?.title).toBe('CLIENT UPDATE DUE · MuvMi still down · 15 min');
    expect(JSON.stringify(card)).toContain(
      'Bua (AM) sends the client message from the draft on the incident page, then marks it. Runs whether or not the incident is acknowledged.',
    );
    expect(JSON.stringify(card)).toContain(
      `"text":"Open draft","onClick":{"openLink":{"url":"${draftUrl}"}}`,
    );
  });

  it('Tier 2 says 60 min in response hours; recovered in that minute says was down', () => {
    const m = alert({ tier: 2, recovered: true });
    expect(m.text).toBe(
      '<users/BUA> CLIENT UPDATE DUE · MuvMi · DOWN 60 min in response hours · draft ready',
    );
    expect(m.cardsV2[0]!.card.header?.title).toBe(
      'CLIENT UPDATE DUE · MuvMi was down · 60 min in response hours',
    );
  });

  it('no AM: Tao (Admin) is @mentioned and the line says so (D-052 item 2)', () => {
    const m = alert({ people: [tao], noAm: true });
    expect(m.text).toBe(
      '<users/TAO> CLIENT UPDATE DUE · MuvMi · DOWN 15 min · no account manager for MuvMi · draft ready',
    );
    expect(JSON.stringify(m.cardsV2)).toContain(
      'MuvMi has no account manager in DxT Monitor, so Tao (Admin) is told',
    );
  });

  it('an AM without a Chat id is named, since a mention can’t reach them', () => {
    expect(alert({ people: [{ name: 'Bua', chatUserId: null }] }).text).toBe(
      'CLIENT UPDATE DUE · MuvMi · DOWN 15 min · for Bua · draft ready',
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
