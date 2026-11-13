import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACTION_WORDS,
  atLabel,
  categoryFilter,
  categoryOf,
  entityFallback,
  rangeStart,
  sidesOf,
  spanLabel,
  wordsOf,
  type Names,
} from './model';

const ARM = '5ea5e000-0000-4000-8000-000000000005';
const TAO = '9616f00a-8540-4cf8-8aef-e25bc4dd9a75';
const names: Names = {
  people: new Map([
    [ARM, 'Arm'],
    [TAO, 'Tao'],
  ]),
};

// Fri 25 Sep 2026 10:07 Bangkok = 03:07 UTC (the board's "now").
const NOW = new Date('2026-09-25T03:07:00Z');

/** Every action code the migrations write: literals next to an audit insert, and the row triggers. */
function actionsInMigrations(): string[] {
  const dir = join(__dirname, '../../../../../supabase/migrations');
  const codes = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
    // Comments out first: one names both codes and has a ';' in it.
    const sql = readFileSync(join(dir, file), 'utf8').replace(/--[^\n]*/g, '');
    for (const m of sql.matchAll(/insert into public\.audit_log[\s\S]{0,2000}?;/g)) {
      for (const lit of m[0].matchAll(/'([a-z_]+\.[a-z_]+)'/g)) codes.add(lit[1]!);
    }
    for (const m of sql.matchAll(/write_audit\(\s*'([a-z_]+\.[a-z_]+)'/g)) codes.add(m[1]!);
    for (const m of sql.matchAll(/audit_row_change\('([a-z_]+)'\)/g)) {
      for (const op of ['create', 'update', 'delete']) codes.add(`${m[1]}.${op}`);
    }
  }
  return [...codes].sort();
}

describe('action codes (D-061 item 3)', () => {
  const codes = actionsInMigrations();

  it('finds the codes the migrations write', () => {
    expect(codes).toContain('incident.opened');
    expect(codes).toContain('site.update');
    expect(codes).toContain('maintenance.series_cancel');
  });

  it.each(codes)('%s has words and a category', (code) => {
    expect(ACTION_WORDS[code], `add words for ${code} to ACTION_WORDS`).toBeTruthy();
    expect(categoryOf(code), `give ${code} a category`).not.toBeNull();
  });

  it('shows an unknown code as itself, under All only', () => {
    expect(wordsOf('thing.happened')).toBe('thing.happened');
    expect(categoryOf('thing.happened')).toBeNull();
  });
});

describe('categoryOf', () => {
  it.each([
    ['incident.ack', 'Incidents'],
    ['system_alert.opened', 'Monitor'],
    ['site.hand_check', 'Monitor'],
    ['site.mute', 'Maintenance & mute'],
    ['site.mute_end', 'Maintenance & mute'],
    ['maintenance.series_create', 'Maintenance & mute'],
    ['site.update', 'Config'],
    ['monitor.delete', 'Config'],
    ['holiday.create', 'Config'],
    ['escalation.update', 'Config'],
    ['page_baseline.accept', 'Config'],
    ['oncall.swap_request', 'On-call'],
    ['user.invite', 'Access'],
  ])('%s → %s', (code, cat) => expect(categoryOf(code)).toBe(cat));
});

describe('categoryFilter', () => {
  it('is null for All', () => expect(categoryFilter('All')).toBeNull());
  it('escapes the underscore and keeps the exact codes', () => {
    expect(categoryFilter('Monitor')).toBe('action.like.system\\_alert.*,action.in.(site.hand_check)');
  });
  it('takes the mute and hand-check codes out of Config', () => {
    expect(categoryFilter('Config')).toContain(
      'and(action.like.site.*,action.not.in.(site.hand_check,site.mute,site.mute_end))',
    );
  });
});

describe('ranges (Bangkok days)', () => {
  it('Today starts at Bangkok midnight', () => {
    expect(rangeStart('Today', NOW)?.toISOString()).toBe('2026-09-24T17:00:00.000Z');
  });
  it('Last 7 days starts seven Bangkok midnights back', () => {
    expect(rangeStart('Last 7 days', NOW)?.toISOString()).toBe('2026-09-17T17:00:00.000Z');
    expect(spanLabel('Last 7 days', NOW)).toBe('Fri 18 Sep → Fri 25 Sep 10:07');
  });
  it('Last 30 days and All time', () => {
    expect(rangeStart('Last 30 days', NOW)?.toISOString()).toBe('2026-08-25T17:00:00.000Z');
    expect(rangeStart('All time', NOW)).toBeNull();
    expect(spanLabel('All time', NOW)).toBe('all time');
    expect(spanLabel('Today', NOW)).toBe('today');
  });
});

describe('atLabel', () => {
  it('today with seconds', () => expect(atLabel(new Date('2026-09-25T03:03:41Z'), NOW)).toBe('10:03:41'));
  it('this week as weekday + time', () =>
    expect(atLabel(new Date('2026-09-24T15:22:00Z'), NOW)).toBe('Thu 22:22'));
  it('older with the date', () =>
    expect(atLabel(new Date('2026-09-18T09:20:00Z'), NOW)).toBe('Fri 18 Sep 16:20'));
  it('just after Bangkok midnight is still today', () =>
    expect(atLabel(new Date('2026-09-24T17:00:05Z'), NOW)).toBe('00:00:05'));
});

describe('sidesOf', () => {
  it('acknowledge: state words, the time', () => {
    const s = sidesOf(
      'incident.ack',
      { state: 'unacked' },
      { state: 'acknowledged', acked_at: '2026-09-25T02:58:02Z' },
      names,
    );
    expect(s).toEqual({ before: 'Unacked', after: 'Acknowledged · acked Fri 25 Sep 09:58', struck: true });
  });

  it('a new incident: "—" before, severity and trigger after, no ids', () => {
    const s = sidesOf(
      'incident.opened',
      null,
      {
        state: 'unacked',
        site_id: ARM,
        trigger: 'hard_fail',
        severity: 'down',
        l0_user_id: null,
        started_at: '2026-09-25T02:48:12Z',
      },
      names,
    );
    expect(s.before).toBe('—');
    expect(s.struck).toBe(false);
    expect(s.after).toBe('Unacked · Hard fail · DOWN · L0 none · started Fri 25 Sep 09:48');
  });

  it('a mute: the reason quoted last', () => {
    const s = sidesOf(
      'site.mute',
      { muted_until: null },
      { reason: 'Redeploying build', window_id: ARM, muted_until: '2026-09-25T11:00:00Z' },
      names,
    );
    expect(s).toEqual({
      before: 'muted until none',
      after: 'muted until Fri 25 Sep 18:00 · “Redeploying build”',
      struck: true,
    });
  });

  it('a row-trigger update shows only what changed', () => {
    const before = { id: 'x', name: 'Tubtong', backup_owner_id: TAO, tier: 1, updated_at: 'a' };
    const after = { ...before, backup_owner_id: ARM, updated_at: 'b' };
    expect(sidesOf('site.update', before, after, names)).toEqual({
      before: 'backup Tao',
      after: 'backup Arm',
      struck: true,
    });
  });

  it('a changed jsonb column shows the keys inside it that changed (review)', () => {
    const before = {
      id: 'm',
      url: 'https://fuji.example.test/',
      thresholds: { slow_ms: 3000, timeout_ms: 10000 },
    };
    const after = { ...before, thresholds: { slow_ms: 5000, timeout_ms: 10000 } };
    expect(sidesOf('monitor.update', before, after, names)).toEqual({
      before: 'thresholds slow ms 3 s',
      after: 'thresholds slow ms 5 s',
      struck: true,
    });
  });

  it('a new monitor by its URL, not the whole row (review)', () => {
    expect(
      sidesOf(
        'monitor.create',
        null,
        { id: 'm', url: 'https://fuji.example.test/shop', method: 'GET', timeout_ms: 10000 },
        names,
      ).after,
    ).toBe('added · https://fuji.example.test/shop');
  });

  it('create and delete', () => {
    expect(sidesOf('site.create', null, { id: 'x', name: 'DxT AI', tier: 2 }, names).after).toBe(
      'added · DxT AI',
    );
    expect(sidesOf('monitor.delete', { id: 'x', path: '/shop' }, null, names)).toEqual({
      before: '/shop',
      after: 'deleted',
      struck: true,
    });
  });

  it('a person id becomes a name; an unknown id is left out', () => {
    expect(
      sidesOf('oncall.swap_request', null, { with: 'unknown-not-uuid', counterpart: ARM }, names).after,
    ).toBe('with unknown-not-uuid · with Arm');
    expect(
      sidesOf('oncall.handover', null, { user: '00000000-0000-4000-8000-000000000000' }, names).after,
    ).toBe('—');
  });

  it('a series rule and its dates', () => {
    const s = sidesOf(
      'maintenance.series_create',
      null,
      {
        rule: { days: [1, 4], freq: 'weekly' },
        reason: 'Plugin updates',
        starts_on: '2026-11-11',
        duration_min: 60,
      },
      names,
    );
    expect(s.after).toBe('rule weekly Mon, Thu · from Wed 11 Nov · minutes 60 · “Plugin updates”');
    expect(sidesOf('x', null, { rule: { freq: 'monthly', day: 15 } }, names).after).toBe(
      'rule monthly day 15',
    );
    expect(sidesOf('x', null, { rule: { freq: 'monthly', nth: 2, weekday: 2 } }, names).after).toBe(
      'rule monthly 2nd Tue',
    );
  });

  // The payload save_escalation_policies writes (20261029144512_oncall_routing.sql).
  const step = (level: number, delayMin: number, targets = ['owner'], channels = ['chat', 'email']) => ({
    level,
    delayMin,
    targets,
    channels,
    fyi: false,
  });
  const policies = (l1: number, extra: ReturnType<typeof step>[] = []) => [
    {
      severity: 'down',
      tier: 1,
      steps: [step(0, 0, ['owner'], ['chat', 'space', 'email']), step(1, l1, ['backup']), ...extra],
    },
    { severity: 'problem', tier: null, steps: [step(0, 0), step(1, 60, ['backup'])] },
  ];

  it('escalation shows only the step that changed, and the note (review H1)', () => {
    const s = sidesOf(
      'escalation.update',
      { policies: policies(10), downReminderMin: 30, problemReminderMin: 60 },
      {
        policies: policies(15),
        downReminderMin: 30,
        problemReminderMin: 60,
        note: 'match client-update timer',
      },
      names,
    );
    expect(s).toEqual({
      before: 'DOWN · Tier 1 · L1 after 10 min',
      after: 'DOWN · Tier 1 · L1 after 15 min · “match client-update timer”',
      struck: true,
    });
  });

  it('escalation: an added step, a reminder change, and a save that changed nothing', () => {
    const s = sidesOf(
      'escalation.update',
      { policies: policies(15), downReminderMin: 30, problemReminderMin: 60 },
      {
        policies: policies(15, [step(2, 30, ['admins'], ['chat'])]),
        downReminderMin: 20,
        problemReminderMin: 60,
        note: 'more cover',
      },
      names,
    );
    expect(s.before).toBe('DOWN · Tier 1 · L2 none; DOWN reminder every 30 min');
    expect(s.after).toBe(
      'DOWN · Tier 1 · L2 after 30 min · Admin · Chat @mention; DOWN reminder every 20 min · “more cover”',
    );
    const same = { policies: policies(15), downReminderMin: 30, problemReminderMin: 60 };
    expect(sidesOf('escalation.update', same, same, names)).toEqual({
      before: '—',
      after: 'no change',
      struck: false,
    });
  });

  it('milliseconds read as seconds; a year shows on an entry from another year', () => {
    const before = { id: 'm', thresholds: { slowMs: 3000 }, timeout_ms: 10000 };
    expect(sidesOf('monitor.update', before, { ...before, thresholds: { slowMs: 5000 } }, names)).toEqual({
      before: 'slow threshold 3 s',
      after: 'slow threshold 5 s',
      struck: true,
    });
    expect(atLabel(new Date('2025-09-18T09:20:00Z'), NOW)).toBe('Thu 18 Sep 2025 16:20');
  });

  it('a page baseline shows its scripts or title', () => {
    const s = sidesOf(
      'page_baseline.accept',
      { fingerprint: { title: 'Test target', scripts: [] } },
      { fingerprint: { title: 'Test target', scripts: ['evil-cdn.example'] } },
      names,
    );
    expect(s).toEqual({ before: 'title “Test target”', after: 'scripts evil-cdn.example', struck: true });
  });

  it('an Undo says what it undid, not the snapshot it restored', () => {
    expect(
      sidesOf(
        'maintenance.undo',
        { action: 'mute_ended_early' },
        { undid: 'mute_ended_early', ends_at: 'x', muted_at: 'y' },
        names,
      ),
    ).toEqual({ before: 'mute ended early', after: 'undid mute ended early', struck: true });
  });

  it('a series cancel counts the windows it cancelled', () => {
    expect(
      sidesOf(
        'maintenance.series_cancel',
        { state: 'approved' },
        { state: 'cancelled', occurrences_cancelled: [{}, {}] },
        names,
      ).after,
    ).toBe('cancelled · 2 windows cancelled');
  });

  it('lists, booleans and a root cause', () => {
    expect(sidesOf('x', null, { notified: [ARM, TAO], not_needed: true }, names).after).toBe(
      'told Arm, Tao · not needed yes',
    );
    expect(sidesOf('x', null, { windows: ['a', 'b'], order: [1, 2] }, names).after).toBe(
      '2 windows · order 1, 2',
    );
    expect(
      sidesOf('incident.root_cause', null, { category: 'dns', what: 'Expired record' }, names).after,
    ).toBe('category DNS / domain · what happened Expired record');
  });
});

describe('entityFallback', () => {
  it('names a system alert by kind and location', () => {
    expect(
      entityFallback('system_alert', null, { kind: 'probe_location_missing', context: { location: 'TYO' } }),
    ).toBe('Probe location missing · TYO');
    expect(entityFallback('system_alert', null, { kind: 'verifier_backlog' })).toBe('Verifier backlog');
  });
  it('fixed names and a deleted row’s own name', () => {
    expect(entityFallback('escalation', null, null)).toBe('Escalation policies');
    expect(entityFallback('oncall_rotation', null, null)).toBe('On-call rotation');
    expect(entityFallback('site', { name: 'Old site' }, null)).toBe('Old site');
    expect(entityFallback('oncall_swap', null, null)).toBe('oncall swap');
  });
});
