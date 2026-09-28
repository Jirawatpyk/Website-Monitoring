// Run with `node --test` (part of `pnpm test`).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertStagingUrl, buildArgs, cliInvocation } from './db-staging.mjs';

const STAGING = 'stagingref1234';
const PROD = 'prodref5678';

test('accepts staging direct and pooler connection strings', () => {
  assert.equal(
    assertStagingUrl(`postgresql://postgres:pw@db.${STAGING}.supabase.co:5432/postgres`, STAGING, PROD),
    true,
  );
  assert.equal(
    assertStagingUrl(
      `postgresql://postgres.${STAGING}:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`,
      STAGING,
      PROD,
    ),
    true,
  );
});

test('refuses production', () => {
  assert.throws(
    () => assertStagingUrl(`postgresql://postgres:pw@db.${PROD}.supabase.co:5432/postgres`, STAGING, PROD),
    /PRODUCTION/,
  );
  assert.throws(
    () =>
      assertStagingUrl(
        `postgresql://postgres.${PROD}:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`,
        STAGING,
        PROD,
      ),
    /PRODUCTION/,
  );
});

test('refuses anything that is not clearly staging', () => {
  assert.throws(
    () => assertStagingUrl('postgresql://postgres:pw@db.otherref.supabase.co:5432/postgres', STAGING, PROD),
    /not the staging/,
  );
  assert.throws(() => assertStagingUrl('', STAGING, PROD), /not set/);
  assert.throws(
    () => assertStagingUrl('postgresql://x@db.a.supabase.co/postgres', STAGING, ''),
    /PROD_PROJECT_REF/,
  );
  assert.throws(() => assertStagingUrl('postgresql://x@db.a.supabase.co/postgres', PROD, PROD), /same/);
  assert.throws(() => assertStagingUrl('not a url', STAGING, PROD), /valid connection string/);
});

test('a password containing the prod ref does not trip the guard', () => {
  assert.equal(
    assertStagingUrl(`postgresql://postgres:${PROD}@db.${STAGING}.supabase.co:5432/postgres`, STAGING, PROD),
    true,
  );
});

test('passes --dry-run through for push only, refuses other flags', () => {
  assert.deepEqual(buildArgs('push', ['--dry-run'], 'URL'), ['db', 'push', '--db-url', 'URL', '--dry-run']);
  assert.deepEqual(buildArgs('reset', [], 'URL'), ['db', 'reset', '--db-url', 'URL']);
  assert.throws(() => buildArgs('reset', ['--dry-run'], 'URL'), /Unsupported/);
  // pnpm forwards the `--` separator; only a leading one is dropped.
  assert.deepEqual(buildArgs('push', ['--', '--dry-run'], 'URL'), [
    'db',
    'push',
    '--db-url',
    'URL',
    '--dry-run',
  ]);
  assert.throws(() => buildArgs('push', ['--dry-run', '--'], 'URL'), /Unsupported/);
  assert.throws(() => buildArgs('push', ['--linked'], 'URL'), /Unsupported/);
});

test('starts a JavaScript launcher with node and a native binary directly', () => {
  assert.deepEqual(cliInvocation('/x/dist/supabase.js', ['db']), {
    file: process.execPath,
    args: ['/x/dist/supabase.js', 'db'],
  });
  assert.deepEqual(cliInvocation('C:\\x\\bin\\supabase.exe', ['db']), {
    file: 'C:\\x\\bin\\supabase.exe',
    args: ['db'],
  });
  assert.deepEqual(cliInvocation('/x/bin/supabase', ['db']), { file: '/x/bin/supabase', args: ['db'] });
});
