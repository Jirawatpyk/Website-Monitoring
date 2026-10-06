import { describe, expect, it } from 'vitest';
import {
  buildAcknowledgedEmail,
  buildDownEmail,
  buildRecoveredEmail,
  EMAIL_FOOTER,
  incidentThreadId,
  type EmailBaseInput,
} from './email-alerts';

// EmailAlert board sample (test data only): MuvMi, INC-0142, confirmed down 09:48:41, acked 10:07,
// back 10:31.
const base: EmailBaseInput = {
  incidentId: 'inc-1',
  incidentNumber: 142,
  site: 'MuvMi',
  tier: 1,
  recipientId: 'u-arm',
  reason: 'owner',
  incidentUrl: 'https://monitor.example.test/incidents/inc-1',
  threadId: '<inc-inc-1@notify.example.test>',
  startsThread: false,
};
const startedAt = new Date('2026-09-25T02:48:10Z');
const confirmedAt = new Date('2026-09-25T02:48:41Z');
const ackedAt = new Date('2026-09-25T03:07:40Z');
const recoveredAt = new Date('2026-09-25T03:31:41Z');
const CAUSE = 'Timeout > 30 s (BKK, TYO) · HTTP 504 (SIN)';

const down = (over: Partial<EmailBaseInput> = {}) =>
  buildDownEmail({ ...base, ...over, confirmedAt, cause: CAUSE, confirmingLocations: 3 });
const acked = (over: Partial<EmailBaseInput> = {}) =>
  buildAcknowledgedEmail({ ...base, ...over, ackedBy: 'Arm', ackedAt, startedAt, confirmedAt });
const recovered = (
  over: Partial<EmailBaseInput> = {},
  ack: { by: string; at: Date } | null = { by: 'Arm', at: ackedAt },
) => buildRecoveredEmail({ ...base, ...over, startedAt, recoveredAt, okLocations: 3, owner: 'Arm', ack });

describe('one thread per incident (spec §10)', () => {
  it('uses one subject for every event: site · Tier · INC id', () => {
    for (const m of [down(), acked(), recovered()]) expect(m.subject).toBe('MuvMi · Tier 1 · INC-0142');
  });

  it('hangs every email on the incident thread id; each after the first replies to it', () => {
    const root = incidentThreadId('inc-1', 'DxT Monitor <alerts@notify.example.test>');
    expect(root).toBe('<inc-inc-1@notify.example.test>');
    expect(incidentThreadId('inc-1', 'nobody')).toBe('<inc-inc-1@localhost>');
    expect(down({ startsThread: true }).headers).toEqual({ References: root });
    for (const m of [acked(), recovered()]) {
      expect(m.headers).toEqual({ 'In-Reply-To': root, References: root });
    }
  });
});

describe('Down email (EmailAlert, D-016)', () => {
  it('leads the preheader and body with the status word, without the escalation promise', () => {
    const m = down();
    expect(m.html).toContain(
      'DOWN — MuvMi confirmed down 09:48:41 · Timeout &gt; 30 s (BKK, TYO) · HTTP 504 (SIN)',
    );
    expect(m.html).not.toMatch(/acknowledge by|Next step|L1/);
    expect(m.text.split('\n')[0]).toBe('DOWN — MuvMi is down');
  });

  it('has the board facts and the owner lede', () => {
    expect(down().text).toContain(
      [
        'Nobody has acknowledged yet. You own MuvMi — please acknowledge or hand it over in the Chat thread.',
        '',
        'Confirmed down: Fri 25 Sep 09:48:41',
        `Cause: ${CAUSE}`,
        'Confirmed by: 3 locations, 2 checks',
        '',
        'Acknowledge: https://monitor.example.test/incidents/inc-1?ack=1',
      ].join('\n'),
    );
  });

  it('says why the person got it, then the record footer', () => {
    expect(down().text).toContain(`You got this because you own MuvMi.\n${EMAIL_FOOTER}`);
    expect(down({ reason: 'fallback' }).text).toContain(
      'You got this because a Google Chat alert for this incident couldn’t be delivered.',
    );
    expect(down({ reason: 'fallback' }).text).toContain('The Google Chat alert couldn’t be delivered');
  });

  it('escapes names in the HTML and adds no tracking', () => {
    const m = down({ site: '<script>x</script>' });
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;');
    expect(m.html).not.toMatch(/<img/);
  });
});

describe('Acknowledged email (EmailAlert, D-016)', () => {
  it('has the board headline and facts, and only who acknowledged', () => {
    const m = acked({ reason: 'acked' });
    expect(m.html).toContain('ACKNOWLEDGED — by Arm 10:07 · MuvMi still down');
    expect(m.text).toContain('ACKNOWLEDGED — Arm has MuvMi\nAcknowledged by Arm.');
    expect(m.text).toContain('Acknowledged: Arm at 10:07\nDown for: 19 min so far (confirmed down 09:48:41)');
    expect(m.text).not.toMatch(/L1|L2|stopped|client/i);
    expect(m.text).toContain('You got this because you acknowledged this incident.');
  });
});

describe('Recovered email (EmailAlert, spec §16.4, D-016)', () => {
  it('has the board facts for the owner, without the root-cause button (S07)', () => {
    const m = recovered();
    expect(m.html).toContain('RECOVERED — MuvMi back at 10:31 · down 43 min · root cause needed');
    expect(m.text).toContain(
      [
        'RECOVERED — MuvMi is back',
        'Needs a root cause before it can be resolved.',
        '',
        'Down for: 43 min (09:48–10:31)',
        'Confirmed by: First OK round from 3 locations → Monitoring',
        'Acknowledged: Arm at 10:07',
        'Still to do: Root cause (Arm)',
        '',
        'Open incident: https://monitor.example.test/incidents/inc-1',
      ].join('\n'),
    );
    expect(m.text).not.toContain('Add root cause');
  });

  it('tells everyone else nothing is needed, and leaves out a missing ack or owner', () => {
    const m = recovered({ reason: 'fallback', recipientId: 'u-tao' }, null);
    expect(m.text).toContain('Nothing needed from you. Arm adds the root cause.');
    expect(m.text).not.toContain('Acknowledged:');
    const noOwner = buildRecoveredEmail({
      ...base,
      reason: 'fallback',
      startedAt,
      recoveredAt,
      okLocations: 2,
      owner: null,
      ack: null,
    });
    expect(noOwner.text).toContain('Nothing needed from you.\n');
    expect(noOwner.text).not.toContain('Still to do');
  });
});

describe('thread root and buttons per person', () => {
  it('gives the owner the leading button, everyone else a secondary one (board)', () => {
    expect(recovered().html).toMatch(
      /background:#18181b;border:1px solid #18181b;color:#ffffff;font-weight:600/,
    );
    expect(recovered({ reason: 'fallback' }).html).toMatch(/background:transparent;border:1px solid #8e8e97/);
  });
});
