import { describe, expect, it } from 'vitest';
import { buildAccountEmail, movedRows, type AccountEmailInput } from './account-alerts';

// Fri 25 Sep 2026 10:08 Bangkok (the board's "now").
const AT = new Date('2026-09-25T03:08:00Z');
const FROM = 'DxT Monitor <alerts@monitor.example.com>';
const base = {
  eventId: 'e1',
  at: AT,
  from: FROM,
  appUrl: 'https://monitor.example.com/',
} as const;

// The board's Role changed: Nok, Responder → Stakeholder.
const nok: AccountEmailInput = {
  ...base,
  kind: 'role_changed',
  fromRole: 'responder',
  toRole: 'stakeholder',
  facts: {
    actor: 'Tao',
    was_am: false,
    manages_clients: false,
    left_rotation: true,
    admins: [],
    moves: [
      { kind: 'owner', place: 'realme.link', with: 'Ploy' },
      { kind: 'owner', place: 'WeCare Studio', with: 'Arm' },
      { kind: 'owner', place: 'Cando Asia', with: 'Arm' },
      { kind: 'backup', place: 'Fuji Links', with: 'Arm' },
      { kind: 'backup', place: 'DxT', with: 'Ploy' },
      // Mon 28 Sep 09:00 → Mon 5 Oct 09:00 Bangkok.
      { kind: 'shift', starts: '2026-09-28T02:00:00Z', ends: '2026-10-05T02:00:00Z', with: 'Arm' },
    ],
  },
};

describe('buildAccountEmail (EmailAlert › Account · role change, spec §34)', () => {
  it('Role changed: subject, preheader, facts, lists, what moved, the button', () => {
    const m = buildAccountEmail(nok);
    expect(m.subject).toBe('Your DxT Monitor role is now Stakeholder');
    expect(m.text).toContain('ROLE CHANGED — You’re now a Stakeholder');
    expect(m.html).toContain(
      'ROLE CHANGED — Tao changed your role from Responder to Stakeholder · Fri 25 Sep 10:08',
    );
    expect(m.text).toContain(
      'Tao changed your role from Responder to Stakeholder · Fri 25 Sep 10:08. It took effect straight away.',
    );
    expect(m.text).toContain('Role: Stakeholder (was Responder)');
    expect(m.text).toContain('Changed by: Tao · Fri 25 Sep 10:08');
    expect(m.text).toContain(
      [
        'YOU CAN NOW',
        '+ Send client reports for clients where you’re Site AM (none yet)',
        '',
        'YOU CAN NO LONGER',
        '– Acknowledge or resolve incidents on your sites',
        '– Schedule maintenance or mute your sites',
        '– Mark client updates, except for clients where you’re Site AM',
        '',
        'YOU KEEP',
        '· The dashboard and history, alerts and digests, uptime reports',
        '',
        'WHAT MOVED TO SOMEONE ELSE',
        'realme.link — owner · Ploy',
        'WeCare Studio, Cando Asia — owner · Arm',
        'Fuji Links — backup · Arm',
        'DxT — backup · Ploy',
        'Your on-call shift Mon 28 Sep → Mon 5 Oct · Arm',
        'You left the on-call rotation.',
      ].join('\n'),
    );
    expect(m.text).toContain('Open DxT Monitor: https://monitor.example.com/');
    expect(m.text).toContain('You got this because your role in DxT Monitor changed.');
    expect(m.text).toContain('Questions about your access: ask an Admin (Tao).');
  });

  it('never threaded: its own References, no In-Reply-To', () => {
    expect(buildAccountEmail(nok).headers).toEqual({ References: '<account-e1@monitor.example.com>' });
  });

  it('Promoted to Admin: WHAT COMES WITH ADMIN first, with the real Admins; no KEEP list', () => {
    const m = buildAccountEmail({
      ...nok,
      toRole: 'admin',
      facts: { ...nok.facts, admins: ['Tao'], moves: [], left_rotation: false },
    });
    expect(m.subject).toBe('Your DxT Monitor role is now Admin');
    expect(m.text).toContain('ROLE CHANGED — You’re now an Admin');
    expect(m.text).toContain(
      'Tao made you an Admin · Fri 25 Sep 10:08. Your sites and on-call shifts stay as they are.',
    );
    const text = m.text;
    expect(text.indexOf('WHAT COMES WITH ADMIN')).toBeLessThan(text.indexOf('YOU CAN NOW'));
    expect(text).toContain(
      '! You now get monitor-fault emails — when the browser verifier stops, fewer than 2 probe locations report, or one location is silent over 3 min. They reach Tao and you from now on.',
    );
    expect(text).toContain(
      '! Responders’ maintenance requests (over 24 h or repeating) come to you to approve.',
    );
    // D-054: the engine-stop mail is Tao-only config, not something the app sends.
    expect(text).not.toMatch(/status engine stops/);
    expect(text).not.toContain('YOU KEEP');
    expect(text).not.toContain('WHAT MOVED');
  });

  it('two other Admins read "Tao, Mint and you"', () => {
    const m = buildAccountEmail({
      ...nok,
      toRole: 'admin',
      facts: { ...nok.facts, admins: ['Tao', 'Mint'] },
    });
    expect(m.text).toContain('They reach Tao, Mint and you from now on.');
  });

  it('Access removed: Was / Removed by, the table and its note, no lists, no button', () => {
    const m = buildAccountEmail({
      ...base,
      kind: 'deactivated',
      fromRole: 'stakeholder',
      toRole: null,
      facts: {
        actor: 'Tao',
        was_am: true,
        manages_clients: false,
        left_rotation: false,
        admins: [],
        moves: [
          { kind: 'am', place: 'Bangkok Airways', with: 'Thee' },
          { kind: 'am', place: 'MuvMi', with: 'Thee' },
        ],
      },
    });
    expect(m.subject).toBe('Your DxT Monitor access was removed');
    expect(m.html).toContain('ACCESS REMOVED — Tao removed your access · Fri 25 Sep 10:08');
    expect(m.text).toContain('ACCESS REMOVED — Your access was removed');
    expect(m.text).toContain('Was: Stakeholder · Site AM');
    expect(m.text).toContain('Removed by: Tao · Fri 25 Sep 10:08');
    expect(m.text).toContain(
      'WHAT MOVED TO SOMEONE ELSE\nSite AM — Bangkok Airways, MuvMi · Thee\nYou no longer get alerts, digests or client-update pings.',
    );
    expect(m.text).not.toMatch(/YOU CAN|Open DxT Monitor/);
    expect(m.html).not.toContain('href=');
    expect(m.text).toContain('You got this because your DxT Monitor account was deactivated.');
  });

  it('Access removed with nothing moved: the note joins the lede, no empty table', () => {
    const m = buildAccountEmail({
      ...base,
      kind: 'deactivated',
      fromRole: 'viewer',
      toRole: null,
      facts: {
        actor: 'Tao',
        was_am: false,
        manages_clients: false,
        left_rotation: false,
        admins: [],
        moves: [],
      },
    });
    expect(m.text).toContain(
      'Ask an Admin if this is a mistake. You no longer get alerts, digests or client-update pings.',
    );
    expect(m.text).toContain('Was: Viewer');
    expect(m.text).not.toContain('WHAT MOVED');
  });

  it('names and places are escaped (security review L6)', () => {
    const m = buildAccountEmail({
      ...nok,
      facts: {
        ...nok.facts,
        actor: '<b>Tao</b>',
        moves: [{ kind: 'owner', place: '<i>x</i>', with: '<u>Arm</u>' }],
      },
    });
    expect(m.html).not.toMatch(/<b>Tao|<i>x|<u>Arm/);
    expect(m.html).toContain('&lt;b&gt;Tao&lt;/b&gt;');
  });
});

describe('the lede (code review)', () => {
  it('a Stakeholder made Admin isn’t told their sites stay', () => {
    const m = buildAccountEmail({
      ...nok,
      fromRole: 'stakeholder',
      toRole: 'admin',
      facts: { ...nok.facts, moves: [], admins: ['Tao'] },
    });
    expect(m.text).toContain('Tao made you an Admin · Fri 25 Sep 10:08. It took effect straight away.');
    expect(m.text).not.toContain('stay as they are');
  });

  it('left the rotation with nothing else moved: the note joins the lede, no empty table', () => {
    const m = buildAccountEmail({
      ...nok,
      toRole: 'viewer',
      facts: { ...nok.facts, moves: [], left_rotation: true },
    });
    expect(m.text).toContain('It took effect straight away. You left the on-call rotation.');
    expect(m.text).not.toContain('WHAT MOVED');
  });
});

describe('movedRows', () => {
  it('groups sites per role and new holder, keeps the order, one row per shift', () => {
    expect(movedRows(nok.facts.moves)).toEqual([
      ['realme.link — owner', 'Ploy'],
      ['WeCare Studio, Cando Asia — owner', 'Arm'],
      ['Fuji Links — backup', 'Arm'],
      ['DxT — backup', 'Ploy'],
      ['Your on-call shift Mon 28 Sep → Mon 5 Oct', 'Arm'],
    ]);
  });
});

// D-078 (spec §43.4): set as / removed from Management — one email, no role lists, nothing moved.
describe('buildAccountEmail · Management (D-078)', () => {
  const mg = (kind: 'management_set' | 'management_removed', others: string[]): AccountEmailInput => ({
    ...base,
    kind,
    fromRole: 'admin',
    toRole: 'admin',
    // as the database writes it (set_management): only actor and others — no moves (message-checker H1)
    facts: { actor: 'Tao', others } as unknown as AccountEmailInput['facts'],
  });

  it('set: subject, who and when, what comes with it, who else is Management', () => {
    const m = buildAccountEmail(mg('management_set', ['Pim']));
    expect(m.subject).toBe('You’re now Management in DxT Monitor');
    expect(m.text).toContain('Tao set you as Management · Fri 25 Sep 10:08. Your role stays Admin.');
    expect(m.text).toContain('WHAT COMES WITH MANAGEMENT');
    expect(m.text).toContain('You get the L2 step on Tier 1 DOWN (+30 min, @mentioned in Chat + email)');
    expect(m.text).toContain('You’re no longer told as an Admin on escalation steps (any tier).');
    expect(m.headers?.References).toBe('<account-e1@monitor.example.com>');
    expect(m.text).toContain('Management now: Pim and you.');
    expect(m.text).toContain('Role: Admin · Management');
    // the role email's parts never show
    expect(m.text).not.toContain('YOU CAN NOW');
    expect(m.text).not.toContain('WHAT MOVED TO SOMEONE ELSE');
    expect(m.text).toContain('You got this because your Management tag in DxT Monitor changed.');
  });

  it('removed: back at L1, and who is left', () => {
    const m = buildAccountEmail(mg('management_removed', []));
    expect(m.subject).toBe('You’re no longer Management in DxT Monitor');
    expect(m.text).toContain('You’re told as an Admin on escalation steps again (Chat + email).');
    expect(m.text).toContain('Nobody is Management now.');
    expect(buildAccountEmail(mg('management_removed', ['Pim', 'Vee'])).text).toContain(
      'Management now: Pim and Vee.',
    );
  });
});
