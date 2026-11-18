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
});
