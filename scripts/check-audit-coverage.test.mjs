import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  PATHS,
  checkAuditCoverage,
  entryPoints,
  parseClasses,
  reachableRpcs,
} from './check-audit-coverage.mjs';

/** A throwaway apps/web/src + supabase/tests + migrations tree. */
function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-coverage-'));
  for (const [p, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    fs.writeFileSync(path.join(root, p), body);
  }
  return {
    src: path.join(root, 'src'),
    tests: path.join(root, 'tests'),
    migrations: path.join(root, 'migrations'),
  };
}

const CLASSES = parseClasses(`
  insert into audit_classes (fn, kind, note) values
    ('ack_incident', 'audited', 'ack.test.sql'),
    ('post_window_action_now', 'exempt', 'Sends early the messages an audited action queued.');
  insert into audit_classes select 'zz_fixture_skips_audit', 'audited', 'fixture.test.sql';
`);

const BASE = {
  'tests/ack.test.sql': 'select public.ack_incident(1); select count(*) from public.audit_log;',
  'migrations/0001.sql':
    "create trigger sites_audit after insert on public.sites for each row execute function private.audit_row_change('site');",
  'src/features/incidents/mutations.ts': "export const ack = (db) => db.rpc('ack_incident', {});",
  'src/features/incidents/actions.ts': [
    "'use server';",
    "import { ack } from './mutations';",
    'export async function acknowledgeIncident() { return ack(db); }',
  ].join('\n'),
};

const REGISTRY = {
  actions: { 'features/incidents/actions.ts#acknowledgeIncident': { rpc: ['ack_incident'] } },
};

test('the classes list is read row by row; the insert … select fixture is not an entry', () => {
  assert.deepEqual([...CLASSES.keys()], ['ack_incident', 'post_window_action_now']);
  assert.equal(CLASSES.get('ack_incident').kind, 'audited');
});

test('a registered action that reaches its audited function through an import passes', () => {
  const dirs = fixture(BASE);
  assert.deepEqual(entryPoints(dirs.src).size, 1);
  assert.ok(
    reachableRpcs(dirs.src, path.join(dirs.src, 'features/incidents/actions.ts')).has('ack_incident'),
  );
  assert.deepEqual(checkAuditCoverage({ ...dirs, registry: REGISTRY, classes: CLASSES }), []);
});

// Done-when 1: a fixture action that deliberately skips audit_log fails the check.
test('a new action that writes a table directly and skips audit_log fails', () => {
  const dirs = fixture({
    ...BASE,
    'src/features/demo/actions.ts': [
      "'use server';",
      'export async function skipsAudit(db, id) {',
      "  await db.from('incidents').update({ state: 'closed' }).eq('id', id);",
      '}',
    ].join('\n'),
  });
  const errors = checkAuditCoverage({ ...dirs, registry: REGISTRY, classes: CLASSES });
  assert.ok(
    errors.some((e) =>
      e.startsWith('features/demo/actions.ts#skipsAudit: not in apps/web/audit-coverage.json'),
    ),
  );
  assert.ok(errors.some((e) => e.startsWith('features/demo/actions.ts: writes incidents directly (update)')));
});

test('registering it doesn’t help: an exempt function, or one it never calls, fails', () => {
  const dirs = fixture({
    ...BASE,
    'src/features/demo/actions.ts': [
      "'use server';",
      "export async function skipsAudit(db) { await db.rpc('post_window_action_now', {}); }",
    ].join('\n'),
  });
  const registry = {
    actions: {
      ...REGISTRY.actions,
      'features/demo/actions.ts#skipsAudit': { rpc: ['post_window_action_now', 'ack_incident'] },
    },
  };
  const errors = checkAuditCoverage({ ...dirs, registry, classes: CLASSES });
  assert.ok(errors.some((e) => e.includes('post_window_action_now is exempt there')));
  assert.ok(errors.some((e) => e.includes("ack_incident isn't called from features/demo/actions.ts")));
});

test('a direct write to a table an audit trigger covers is fine; an allowed table needs its reason', () => {
  const dirs = fixture({
    ...BASE,
    'src/server/probe.ts': [
      "export const a = (db) => db.from('sites').update({ name: 'x' });",
      "export const b = (db) => db.from('check_results').insert({});",
    ].join('\n'),
  });
  assert.deepEqual(
    checkAuditCoverage({
      ...dirs,
      registry: { ...REGISTRY, directWrites: { check_results: 'Probe results, monitoring data.' } },
      classes: CLASSES,
    }),
    [],
  );
  assert.ok(
    checkAuditCoverage({
      ...dirs,
      registry: { ...REGISTRY, directWrites: { check_results: 'x' } },
      classes: CLASSES,
    }).some((e) => e.startsWith('directWrites.check_results: needs a reason')),
  );
});

test('route handlers are entries (cron routes are GET), and a stale registry entry fails', () => {
  const dirs = fixture({
    ...BASE,
    'src/app/api/cron/demo/route.ts':
      "export const GET = handler('x');\nexport const dynamic = 'force-dynamic';",
  });
  assert.ok(entryPoints(dirs.src).has('app/api/cron/demo/route.ts#GET'));
  assert.ok(!entryPoints(dirs.src).has('app/api/cron/demo/route.ts#dynamic'));
  const registry = {
    actions: {
      ...REGISTRY.actions,
      'features/gone/actions.ts#old': { exempt: 'Was removed in a later slice.' },
    },
    routes: { 'app/api/cron/demo/route.ts#GET': { exempt: 'x' } },
  };
  const errors = checkAuditCoverage({ ...dirs, registry, classes: CLASSES });
  assert.ok(errors.some((e) => e.startsWith('app/api/cron/demo/route.ts#GET: "exempt" needs a reason')));
  assert.ok(
    errors.some((e) =>
      e.startsWith('features/gone/actions.ts#old: in apps/web/audit-coverage.json but no such'),
    ),
  );
});

test('an audited function whose named test doesn’t read audit_log fails', () => {
  const dirs = fixture({ ...BASE, 'tests/ack.test.sql': 'select public.ack_incident(1);' });
  const errors = checkAuditCoverage({ ...dirs, registry: REGISTRY, classes: CLASSES });
  assert.ok(errors.some((e) => e.includes('ack_incident — ack.test.sql must call it and read audit_log')));
});

// Runs in CI through `pnpm test:coverage`, which doesn't run `pnpm check`.
test('the repo: every action and route is classified', () => {
  const errors = checkAuditCoverage({
    src: PATHS.src,
    registry: JSON.parse(fs.readFileSync(PATHS.registry, 'utf8')),
    classes: parseClasses(fs.readFileSync(PATHS.classes, 'utf8')),
    tests: PATHS.tests,
    migrations: PATHS.migrations,
  });
  assert.deepEqual(errors, []);
});
