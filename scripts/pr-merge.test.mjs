import assert from 'node:assert/strict';
import test from 'node:test';

import {
  actionsCantStart,
  buildsWeb,
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

test('refuses a migration while Actions on main can’t start (billing, 29 Oct 2026)', () => {
  const blocked = [
    { name: 'check', conclusion: 'failure', steps: [] },
    { name: 'db', conclusion: 'failure', steps: [] },
    { name: 'migrate-production', conclusion: 'skipped', steps: [] },
  ];
  assert.equal(actionsCantStart(blocked), true);
  // a real failure ran steps; a run with nothing but skips isn't blocked
  assert.equal(
    actionsCantStart([{ name: 'check', conclusion: 'failure', steps: [{ name: 'Lint' }] }]),
    false,
  );
  assert.equal(actionsCantStart([{ name: 'migrate-production', conclusion: 'skipped', steps: [] }]), false);
  const migration = {
    ...green,
    files: [{ path: 'supabase/migrations/20261029051916_escalation_l2_l3.sql' }],
  };
  const problems = mergeBlockers(migration, { mainActionsBlocked: true });
  assert.equal(problems.length, 1);
  assert.ok(problems[0].includes('migrate-production would not run'));
  // a PR without migrations still merges (Vercel deploys it either way)
  assert.deepEqual(mergeBlockers(green, { mainActionsBlocked: true }), []);
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

// Vercel's production deployments of #89's merge (12 Oct 2026), newest first: the build failed
// (`git_info_fail`) and a redeploy 12 min later went live.
const failed = { uid: 'dpl_2Wng', state: 'ERROR', url: 'dxt-monitor-5zvphanjy.vercel.app' };
const redeployed = {
  uid: 'dpl_9dP7',
  state: 'READY',
  url: 'dxt-monitor-f46aw29sb.vercel.app',
  aliasAssigned: 1791992843562,
};
const minute = 60_000;

const migrated = { status: 'completed', conclusion: 'success' };

test('deployVerdict: production ready, failed, redeployed, skipped, timed out', () => {
  const building = { state: 'BUILDING' };
  const v = (deployments, elapsedMs) => deployVerdict({ deployments, migrate: migrated, elapsedMs });
  assert.equal(v([building], minute).kind, 'waiting');
  assert.match(v([failed], minute).why, /dpl_2Wng.*--logs/);
  assert.deepEqual(v([redeployed, failed], 13 * minute), {
    kind: 'ready',
    url: 'https://dxt-monitor-f46aw29sb.vercel.app',
  });
  assert.equal(v([{ state: 'CANCELED' }], minute).kind, 'none');
  assert.equal(v([], NO_DEPLOY_AFTER_MS - 1).kind, 'waiting');
  assert.equal(v([], NO_DEPLOY_AFTER_MS).kind, 'none');
  assert.equal(v([building], DEPLOY_TIMEOUT_MS).kind, 'failed');
});

test('deployVerdict: a web change with no build fails with the git deploy command (15 Oct: #121)', () => {
  const sha = 'a'.repeat(40);
  const v = (deployments, elapsedMs) =>
    deployVerdict({ deployments, migrate: migrated, elapsedMs, sha, buildsWeb: true });
  assert.equal(v([], NO_DEPLOY_AFTER_MS - 1).kind, 'waiting');
  const none = v([], NO_DEPLOY_AFTER_MS);
  assert.equal(none.kind, 'failed');
  assert.match(none.why, /never started a build/);
  assert.match(none.why, new RegExp(`/v13/deployments.*${sha}|${sha}.*`));
  assert.match(v([{ state: 'CANCELED' }], minute).why, /cancelled the build/);
});

test('buildsWeb: the app, packages and the lockfile rebuild it; docs, the agent and migrations alone do not', () => {
  const pr = (...paths) => ({ files: paths.map((path) => ({ path })) });
  assert.equal(buildsWeb(pr('apps/web/src/features/page-change/model.ts')), true);
  assert.equal(buildsWeb(pr('packages/engine/src/site.ts')), true);
  assert.equal(buildsWeb(pr('pnpm-lock.yaml')), true);
  assert.equal(
    buildsWeb(pr('docs/retro.md', 'apps/vps-agent/src/main.ts', 'supabase/migrations/x.sql')),
    false,
  );
});

test('deployVerdict: production counts only once migrate-production succeeded (14 Oct: Actions billing)', () => {
  const migrate = (status, conclusion = null) => ({ status, conclusion });
  assert.equal(deployVerdict({ migrate: migrate('completed', 'failure'), elapsedMs: 0 }).kind, 'failed');
  // check / db never started, so migrate-production was skipped while Vercel went live: not "live".
  const skipped = deployVerdict({
    migrate: migrate('completed', 'skipped'),
    deployments: [redeployed],
    elapsedMs: 0,
  });
  assert.equal(skipped.kind, 'failed');
  assert.match(skipped.why, /didn't run.*billing/);
  // Deployed but the migration is still running (or hasn't started): keep waiting, then fail at 15 min.
  assert.equal(
    deployVerdict({ migrate: migrate('in_progress'), deployments: [redeployed], elapsedMs: 0 }).kind,
    'waiting',
  );
  assert.equal(
    deployVerdict({ migrate: null, deployments: [redeployed], elapsedMs: minute }).kind,
    'waiting',
  );
  assert.match(
    deployVerdict({ migrate: null, deployments: [redeployed], elapsedMs: DEPLOY_TIMEOUT_MS }).why,
    /never started/,
  );
  assert.equal(deployVerdict({ migrate: migrated, deployments: [redeployed], elapsedMs: 0 }).kind, 'ready');
  assert.equal(
    deployVerdict({ migrate: migrate('completed', 'neutral'), deployments: [redeployed], elapsedMs: 0 }).kind,
    'ready',
  );
});

test("deployVerdict: READY isn't live until the production domains move to it (14 Oct: #114)", () => {
  const v = (deployment, elapsedMs) =>
    deployVerdict({ migrate: migrated, deployments: [deployment], elapsedMs });
  // Vercel built it while the checks on main still ran; monitor.dxtspace.com served the deploy before.
  const staged = {
    uid: 'dpl_5n1l',
    state: 'READY',
    url: 'dxt-monitor-5n1l1uick.vercel.app',
    aliasAssigned: null,
  };
  assert.equal(v(staged, minute).kind, 'waiting');
  assert.match(v(staged, DEPLOY_TIMEOUT_MS).why, /dpl_5n1l.*still point at an older one/);
  assert.match(
    v({ ...staged, aliasError: { code: 'alias_failed' } }, minute).why,
    /domains weren't moved.*alias_failed/,
  );
  assert.equal(v({ ...staged, aliasAssigned: 1791992843562 }, minute).kind, 'ready');
});
