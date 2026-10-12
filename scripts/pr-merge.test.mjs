import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deployVerdict,
  mergeBlockers,
  DEPLOY_TIMEOUT_MS,
  NO_DEPLOY_AFTER_MS,
  WORKFLOW_FLAG,
  SCHEMA_FLAG,
} from './pr-merge.mjs';

const green = {
  state: 'OPEN',
  isDraft: false,
  baseRefName: 'main',
  mergeable: 'MERGEABLE',
  reviewDecision: '',
  statusCheckRollup: [
    { name: 'check', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'db', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'migrate-production', status: 'COMPLETED', conclusion: 'SKIPPED' },
  ],
};

test('a green, open PR against main may be merged', () => {
  assert.deepEqual(mergeBlockers(green), []);
});

test('refuses while CI check is running, failed or missing', () => {
  const running = {
    ...green,
    statusCheckRollup: [
      { name: 'check', status: 'IN_PROGRESS', conclusion: '' },
      { name: 'db', status: 'COMPLETED', conclusion: 'SUCCESS' },
    ],
  };
  assert.match(mergeBlockers(running).join(), /still in_progress/);
  const failed = {
    ...green,
    statusCheckRollup: [{ name: 'check', status: 'COMPLETED', conclusion: 'FAILURE' }],
  };
  assert.match(mergeBlockers(failed).join(), /ended FAILURE/);
  assert.match(mergeBlockers({ ...green, statusCheckRollup: [] }).join(), /has not run/);
});

test('refuses when any other check failed', () => {
  const pr = {
    ...green,
    statusCheckRollup: [
      ...green.statusCheckRollup,
      { name: 'dependency-review', status: 'COMPLETED', conclusion: 'FAILURE' },
    ],
  };
  assert.match(mergeBlockers(pr).join(), /"dependency-review" ended FAILURE/);
});

test('refuses until the db job (pgTAP) has also succeeded', () => {
  const only = (db) => ({ ...green, statusCheckRollup: [green.statusCheckRollup[0], ...db] });
  assert.match(mergeBlockers(only([])).join(), /CI "db" has not run/);
  assert.match(
    mergeBlockers(only([{ name: 'db', status: 'IN_PROGRESS', conclusion: '' }])).join(),
    /CI "db" is still in_progress/,
  );
  assert.match(
    mergeBlockers(only([{ name: 'db', status: 'COMPLETED', conclusion: 'FAILURE' }])).join(),
    /CI "db" ended FAILURE/,
  );
});

test('refuses drafts, closed PRs, other bases, conflicts and requested changes', () => {
  assert.equal(mergeBlockers({ ...green, isDraft: true }).length, 1);
  assert.equal(mergeBlockers({ ...green, state: 'MERGED' }).length, 1);
  assert.equal(mergeBlockers({ ...green, baseRefName: 'staging' }).length, 1);
  assert.equal(mergeBlockers({ ...green, mergeable: 'CONFLICTING' }).length, 1);
  assert.equal(mergeBlockers({ ...green, reviewDecision: 'CHANGES_REQUESTED' }).length, 1);
});

test('refuses CI file changes until they are marked as reviewed', () => {
  const pr = { ...green, files: [{ path: '.github/workflows/ci.yml' }, { path: 'docs/workflow.md' }] };
  const problems = mergeBlockers(pr);
  assert.equal(problems.length, 1);
  assert.ok(problems[0].includes('.github/workflows/ci.yml') && problems[0].includes(WORKFLOW_FLAG));
  assert.deepEqual(mergeBlockers(pr, { workflowChangesReviewed: true }), []);
  assert.deepEqual(mergeBlockers({ ...green, files: [{ path: 'docs/workflow.md' }] }), []);
});

test('refuses migrations and runtime code together unless the schema lag was reviewed (8 Oct 2026)', () => {
  const pr = {
    ...green,
    files: [
      { path: 'supabase/migrations/20261008093801_tls_chain_trigger.sql' },
      { path: 'packages/engine/src/site.ts' },
      { path: 'packages/engine/src/site.test.ts' },
    ],
  };
  const problems = mergeBlockers(pr);
  assert.equal(problems.length, 1);
  assert.ok(problems[0].includes('1 files') && problems[0].includes(SCHEMA_FLAG));
  assert.deepEqual(mergeBlockers(pr, { schemaLagReviewed: true }), []);
  // a migration with its tests and docs only, or code without a migration, needs no flag
  assert.deepEqual(
    mergeBlockers({
      ...green,
      files: [{ path: 'supabase/migrations/x.sql' }, { path: 'supabase/tests/x.test.sql' }],
    }),
    [],
  );
  assert.deepEqual(mergeBlockers({ ...green, files: [{ path: 'packages/engine/src/site.ts' }] }), []);
  // a migration with only its regenerated types is the migration-first PR
  assert.deepEqual(
    mergeBlockers({
      ...green,
      files: [{ path: 'supabase/migrations/x.sql' }, { path: 'packages/db/src/database.types.ts' }],
    }),
    [],
  );
});

// GitHub's statuses for #89's production deployment (12 Oct 2026), newest first.
const failed = {
  state: 'failure',
  description: 'Deployment has failed — run this Vercel CLI command: npx vercel inspect dpl_2Wng --logs',
};
const redeployed = { state: 'success', environment_url: 'https://dxt-monitor-f46aw29sb.vercel.app' };
const minute = 60_000;

test('deployVerdict: production ready, failed, redeployed, skipped, timed out', () => {
  assert.equal(deployVerdict({ statuses: [{ state: 'in_progress' }], elapsedMs: minute }).kind, 'waiting');
  assert.match(deployVerdict({ statuses: [failed], elapsedMs: minute }).why, /dpl_2Wng/);
  assert.deepEqual(deployVerdict({ statuses: [redeployed, failed], elapsedMs: 13 * minute }), {
    kind: 'ready',
    url: redeployed.environment_url,
  });
  assert.equal(deployVerdict({ statuses: [], elapsedMs: NO_DEPLOY_AFTER_MS - 1 }).kind, 'waiting');
  assert.equal(deployVerdict({ statuses: [], elapsedMs: NO_DEPLOY_AFTER_MS }).kind, 'none');
  assert.equal(
    deployVerdict({ statuses: [{ state: 'queued' }], elapsedMs: DEPLOY_TIMEOUT_MS }).kind,
    'failed',
  );
});

test('deployVerdict: a failed migrate-production fails the merge; skipped or running does not', () => {
  const migrate = (status, conclusion = null) => ({ status, conclusion });
  assert.equal(deployVerdict({ migrate: migrate('completed', 'failure'), elapsedMs: 0 }).kind, 'failed');
  assert.equal(deployVerdict({ migrate: migrate('completed', 'skipped'), elapsedMs: 0 }).kind, 'waiting');
  assert.equal(
    deployVerdict({ migrate: migrate('in_progress'), statuses: [redeployed], elapsedMs: 0 }).kind,
    'ready',
  );
});
