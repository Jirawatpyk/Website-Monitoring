import { describe, expect, it } from 'vitest';
import { timelineOf } from './model';

// D-067 (test data only): INC-0136 DxT AI opened for SSL expiring Wed 23 Sep 09:00, a forbidden word
// took over at 10:00, it cleared at 11:00 with the certificate still 13 days out.
const at = (t: string) => `2026-09-23T${t}+07:00`;
const nameOf = () => 'someone';
const ev = (type: string, t: string, payload: Record<string, unknown>) => ({
  type,
  at: at(t),
  actor_id: null,
  payload,
});

describe('timelineOf — a new cause and back to the expiry (D-067 items 2, 4)', () => {
  const i = {
    severity: 'problem' as const,
    trigger: 'ssl' as const,
    startedAt: at('09:00:00'),
    recoveredAt: null,
  };
  const events = [
    ev('detected', '09:00:00', { cause: 'SSL certificate expires in 13 days (Tue 6 Oct)' }),
    ev('new_cause', '10:00:00', {
      cause: 'Found “บาคาร่า” on / (as Googlebot)',
      trigger: 'keyword',
      was: 'ssl',
    }),
    ev('new_cause', '11:00:00', {
      cause: 'SSL certificate expires in 13 days (Tue 6 Oct)',
      trigger: 'ssl',
      was: 'keyword',
      back: true,
    }),
  ];

  it('says when an ack of the expiry was set aside or cleared (D-067 items 2, 6)', () => {
    const t = timelineOf(
      { ...i, severity: 'down' },
      [
        events[0]!,
        ev('new_cause', '10:00:00', {
          cause: 'Found “บาคาร่า”',
          trigger: 'keyword',
          was: 'ssl',
          ackCleared: true,
        }),
        ev('escalated_to_down', '10:30:00', { cause: 'Timeout', ackCleared: true }),
        ev('relapsed', '11:30:00', { severity: 'down', summary: 'Timeout', ackCleared: true }),
      ],
      nameOf,
      new Date(at('11:35:00')),
    );
    const details = t.map((x) => x.detail ?? '');
    // Spec §40.5: its own row (no name stored by an older row: the generic words).
    expect(t.filter((x) => x.title === 'Acknowledgement set aside')).toMatchObject([
      { kind: 'ack', detail: 'The acknowledgement of SSL expiring doesn’t cover Keyword — it needs its own' },
    ]);
    expect(details.filter((d) => d.includes('the acknowledgement of the expiry was cleared'))).toHaveLength(
      2,
    );
  });

  it('SSL renewed with the domain still due: "Now Domain expiring"', () => {
    const t = timelineOf(
      i,
      [
        events[0]!,
        ev('new_cause', '11:00:00', {
          trigger: 'domain',
          was: 'ssl',
          back: true,
          cause: 'Domain expires in 18 days',
        }),
      ],
      nameOf,
      new Date(at('11:05:00')),
    );
    expect(t.map((x) => [x.title, x.detail])).toContainEqual([
      'Now Domain expiring',
      'was SSL expiring · nobody was told',
    ]);
  });

  it('says what took over, and that it went back without telling anyone', () => {
    const t = timelineOf(i, events, nameOf, new Date(at('11:05:00')));
    expect(t.map((x) => [x.title, x.detail])).toEqual(
      expect.arrayContaining([
        ['New cause: Keyword', 'Found “บาคาร่า” on / (as Googlebot) · was SSL expiring'],
        ['Back to SSL expiring', 'Keyword cleared · nobody was told'],
      ]),
    );
  });

  // Spec §40.5, D-068: INC-0136's day — acked 09:20, keyword 14:20, back 15:05, DOWN 16:10, back up 16:18.
  it('§40.5: set aside, given back, and back up · still SSL expiring', () => {
    const detail = { kind: 'ssl', expiresAt: '2026-10-06T13:00:00Z', daysLeft: 13 };
    const t = timelineOf(
      { ...i, severity: 'down' },
      [
        events[0]!,
        ev('new_cause', '14:20:00', {
          cause: 'Found “บาคาร่า” on / (as Googlebot)',
          trigger: 'keyword',
          was: 'ssl',
          ackCleared: true,
          setAside: { by: 'Tao', at: at('09:20:00') },
        }),
        ev('new_cause', '15:05:00', {
          trigger: 'ssl',
          was: 'keyword',
          back: true,
          ackBack: { by: 'Tao', at: at('09:20:00') },
        }),
        ev('escalated_to_down', '16:10:00', {
          cause: 'Timeout',
          ackCleared: true,
          startedAt: at('16:10:00'),
        }),
        ev('recovered', '16:18:00', { okLocations: 3 }),
        ev('relapsed', '16:18:00', {
          severity: 'problem',
          trigger: 'ssl',
          homeBackAt: at('16:18:00'),
          stillExpiry: true,
          detail,
        }),
      ],
      nameOf,
      new Date(at('16:20:00')),
    );
    const row = (title: string) => t.find((x) => x.title === title);
    expect(row('Acknowledgement set aside')).toMatchObject({
      kind: 'ack',
      detail: 'Tao’s acknowledgement of SSL expiring (09:20) doesn’t cover Keyword — it needs its own',
    });
    expect(row('Acknowledgement given back')).toMatchObject({
      kind: 'ack',
      detail: 'Acknowledged by Tao 09:20 again — it was for SSL expiring',
    });
    expect(row('Back up · still SSL expiring')).toMatchObject({
      kind: 'recovered',
      detail:
        'First OK round after 8 min down · SSL certificate expires in 13 days (Tue 6 Oct) · the DOWN needs a root cause',
    });
    // One line for the round, not RECOVERED + PROBLEM AGAIN.
    expect(t.filter((x) => x.time.startsWith('16:18'))).toHaveLength(1);
  });
});
