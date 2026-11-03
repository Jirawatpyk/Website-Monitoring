import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coverageArgs, coveragePackagesFor } from './pre-push-coverage.mjs';

const packages = {
  'apps/web': { name: '@dxt/web', scripts: { 'test:coverage': 'vitest run --coverage' } },
  'packages/notifier': { name: '@dxt/notifier', scripts: { 'test:coverage': 'vitest run --coverage' } },
  'packages/db': { name: '@dxt/db', scripts: { typecheck: 'tsc --noEmit' } },
};
const read = (dir) => packages[dir] ?? null;

test('each touched package runs once, by its package.json name (the PR #164 case: notifier)', () => {
  const changed = [
    'packages/notifier/src/client-update.ts',
    'packages/notifier/src/client-update.test.ts',
    'apps/web/src/server/runner.ts',
  ];
  assert.deepEqual(coveragePackagesFor(changed, read), ['@dxt/notifier', '@dxt/web']);
});

test('a package without a test:coverage script is left out (pnpm --filter would fail on it)', () => {
  assert.deepEqual(coveragePackagesFor(['packages/db/src/database.types.ts'], read), []);
});

test('docs, scripts and root files touch no package', () => {
  assert.deepEqual(coveragePackagesFor(['docs/retro.md', 'scripts/pr-merge.mjs', 'package.json'], read), []);
});

test('a path is matched only inside a package directory, not by its prefix', () => {
  assert.deepEqual(coveragePackagesFor(['packages/notifier.md', 'apps/web'], read), []);
  assert.deepEqual(coveragePackagesFor(['apps\\web\\src\\x.ts'], read), ['@dxt/web']);
});

test('one pnpm call filters every package; nothing runs when none was touched', () => {
  assert.deepEqual(coverageArgs(['@dxt/notifier', '@dxt/web']), [
    '--filter',
    '@dxt/notifier',
    '--filter',
    '@dxt/web',
    'test:coverage',
  ]);
  assert.equal(coverageArgs([]), null);
});
