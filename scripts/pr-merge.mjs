// Squash-merge a pull request only when it is safe to (D-008).
//
//   pnpm pr:merge <number> [--workflow-changes-reviewed] [--schema-lag-reviewed]
//
// The repository is private on GitHub Free, so the ruleset "main" is not enforced and GitHub would
// merge a PR with a red or unfinished CI. This script refuses unless the PR is open, not a draft,
// targets main, has no requested changes, and the CI jobs `check` and `db` succeeded on its current
// head commit, and — when the PR changes CI files that can read repository secrets — the caller passed
// --workflow-changes-reviewed; it then merges that exact commit (`--match-head-commit`), so a push after the check
// can't slip in. No shell: arguments go straight to `gh`.
// A PR that changes migrations and runtime code together also needs --schema-lag-reviewed: the new
// deployment's crons start before `migrate-production` ends (docs/workflow.md, 8 Oct 2026), so that
// code must work on the old schema — or the migration merges alone first.
// After the merge it waits for production: the merge commit's `migrate-production` and its Vercel
// production deployment, and exits 1 if either failed — on 12 Oct a production build failed
// (`git_info_fail`) and nobody saw it for 10 min. The deployment comes from Vercel's API through the
// signed-in `vercel` CLI: GitHub Deployments aren't posted for every commit (#93 had none and the
// first version of this wait called its live deploy "skipped"). A build Vercel skipped or cancelled,
// or no deployment within a few minutes, is a warning, not a failure. --no-wait skips the wait.
import { execFileSync, execSync } from 'node:child_process';
import path from 'node:path';

export const REQUIRED_CHECKS = ['check', 'db'];
const FAILED = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);

export const WORKFLOW_FLAG = '--workflow-changes-reviewed';
export const SCHEMA_FLAG = '--schema-lag-reviewed';
export const NO_WAIT_FLAG = '--no-wait';

/** The Vercel project that deploys `main` to production, and its team (docs/workflow.md). */
export const VERCEL_PROJECT = 'dxt-monitor';
export const VERCEL_TEAM = 'team_KLEKhF6PuSAbJSmgDpyEXES4';
/** No production deployment by then: Vercel skipped the build (Ignored Build Step). */
export const NO_DEPLOY_AFTER_MS = 4 * 60_000;
/** Give up waiting for a deployment that started but never finished. */
export const DEPLOY_TIMEOUT_MS = 15 * 60_000;

/**
 * Where production stands for the merge commit. `deployments` are Vercel's production deployments of
 * that commit, newest first (a redeploy after a failure is newer); `migrate` is the
 * `migrate-production` check-run, if any.
 */
export function deployVerdict({ deployments = [], migrate = null, elapsedMs }) {
  if (migrate?.status === 'completed' && !['success', 'skipped', 'neutral'].includes(migrate.conclusion)) {
    return { kind: 'failed', why: `migrate-production ended ${migrate.conclusion}` };
  }
  const latest = deployments[0];
  if (latest?.state === 'READY') return { kind: 'ready', url: `https://${latest.url}` };
  if (latest?.state === 'ERROR') {
    return { kind: 'failed', why: `deployment ${latest.uid} failed — vercel inspect ${latest.url} --logs` };
  }
  if (latest?.state === 'CANCELED') return { kind: 'none' };
  if (!latest && elapsedMs >= NO_DEPLOY_AFTER_MS) return { kind: 'none' };
  if (elapsedMs >= DEPLOY_TIMEOUT_MS) return { kind: 'failed', why: 'still not ready after 15 min' };
  return { kind: 'waiting' };
}

/** Runtime code (not tests) that a deploy starts before its migrations are applied. */
export function migrationWithCode(pr) {
  const paths = (pr.files ?? []).map((f) => f.path);
  if (!paths.some((p) => p.startsWith('supabase/migrations/'))) return [];
  return paths.filter(
    (p) =>
      /^(apps\/web\/src|apps\/vps-agent\/src|packages\/[^/]+\/src)\//.test(p) &&
      !/\.test\.tsx?$/.test(p) &&
      // generated types change with every migration and run nothing
      p !== 'packages/db/src/database.types.ts',
  );
}

/** Changed files that run in CI and can read repository secrets (`.github/workflows/`, `.github/actions/`). */
export function ciFiles(pr) {
  return (pr.files ?? []).map((f) => f.path).filter((p) => /^\.github\/(workflows|actions)\//.test(p));
}

/** Reasons the PR must not be merged yet; empty when it may be merged. */
export function mergeBlockers(pr, { workflowChangesReviewed = false, schemaLagReviewed = false } = {}) {
  const problems = [];
  const code = migrationWithCode(pr);
  if (code.length && !schemaLagReviewed) {
    problems.push(
      `it changes migrations and runtime code together (${code.length} files) — the new deployment's crons run before migrate-production: merge the migration alone first, or confirm the code works on the old schema, then re-run with ${SCHEMA_FLAG}`,
    );
  }
  const ci = ciFiles(pr);
  if (ci.length && !workflowChangesReviewed) {
    problems.push(
      `it changes CI files that can read repository secrets (${ci.join(', ')}) — review them, then re-run with ${WORKFLOW_FLAG}`,
    );
  }
  if (pr.state !== 'OPEN') problems.push(`the PR is ${pr.state.toLowerCase()}`);
  if (pr.isDraft) problems.push('the PR is a draft');
  if (pr.baseRefName !== 'main') problems.push(`it targets ${pr.baseRefName}, not main`);
  if (pr.mergeable === 'CONFLICTING') problems.push('it has merge conflicts with main');
  else if (pr.mergeable !== 'MERGEABLE')
    problems.push('GitHub has not finished checking for conflicts — run again in a moment');
  if (pr.reviewDecision === 'CHANGES_REQUESTED') problems.push('a reviewer requested changes');

  const checks = pr.statusCheckRollup ?? [];
  for (const name of REQUIRED_CHECKS) {
    const runs = checks.filter((c) => c.name === name);
    if (runs.length === 0) problems.push(`CI "${name}" has not run on the head commit`);
    for (const c of runs) {
      if (c.status !== 'COMPLETED') problems.push(`CI "${name}" is still ${c.status.toLowerCase()}`);
      else if (c.conclusion !== 'SUCCESS') problems.push(`CI "${name}" ended ${c.conclusion}`);
    }
  }
  for (const c of checks) {
    if (!REQUIRED_CHECKS.includes(c.name) && c.status === 'COMPLETED' && FAILED.has(c.conclusion)) {
      problems.push(`check "${c.name}" ended ${c.conclusion}`);
    }
  }
  return problems;
}

function gh(args, options = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', ...options });
}

const json = (args) => JSON.parse(gh(args));

/**
 * Vercel's production deployments of `sha`, newest first, through the signed-in CLI (`vercel api`).
 * The CLI is a .cmd shim on Windows, so it runs through a shell; every argument is a constant or a
 * hex SHA checked here.
 */
export function vercelDeployments(sha) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`unexpected merge SHA ${sha}`);
  const query = `/v6/deployments?teamId=${VERCEL_TEAM}&app=${VERCEL_PROJECT}&target=production&limit=20`;
  const out = execSync(`vercel api "${query}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const { deployments = [] } = JSON.parse(out.slice(out.indexOf('{')));
  return deployments.filter((d) => d.meta?.githubCommitSha === sha).sort((a, b) => b.created - a.created);
}

/** Polls until production is ready, failed, or (no deployment at all) skipped. */
async function waitForProduction(number) {
  const sha = json(['pr', 'view', number, '--json', 'mergeCommit']).mergeCommit?.oid;
  if (!sha) {
    console.error('pr:merge — merged, but GitHub has no merge commit yet; check production by hand.');
    process.exit(1);
  }
  console.info(`pr:merge — waiting for migrate-production and the production deploy of ${sha.slice(0, 7)}…`);
  const started = Date.now();
  for (;;) {
    let deployments;
    try {
      deployments = vercelDeployments(sha);
    } catch {
      // The merge already happened: say what to check instead of dying with a stack trace.
      console.error(
        `pr:merge — merged, but couldn't read Vercel (is the vercel CLI installed and signed in?). Check the production deploy of ${sha.slice(0, 7)} in the Vercel dashboard.`,
      );
      process.exit(1);
    }
    const runs = json([
      'api',
      `repos/{owner}/{repo}/commits/${sha}/check-runs?check_name=migrate-production`,
    ]);
    const v = deployVerdict({
      deployments,
      migrate: runs.check_runs?.[0] ?? null,
      elapsedMs: Date.now() - started,
    });
    if (v.kind === 'ready') return console.info(`pr:merge — production is live: ${v.url}`);
    if (v.kind === 'none') {
      return console.warn(
        'pr:merge — no production deployment: Vercel skipped or cancelled the build (agent- or docs-only?). Check the Vercel dashboard if this commit changes the web app.',
      );
    }
    if (v.kind === 'failed') {
      console.error(`pr:merge — merged, but production did NOT deploy: ${v.why}`);
      console.error('  Redeploy: vercel --scope <team> redeploy <deployment url> --target production');
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

async function main() {
  // pnpm forwards a `--` separator (`pnpm pr:merge 9 -- --flag`); ignore it.
  const [number, ...flags] = process.argv.slice(2).filter((a) => a !== '--');
  const unknown = flags.filter((f) => ![WORKFLOW_FLAG, SCHEMA_FLAG, NO_WAIT_FLAG].includes(f));
  if (!/^\d+$/.test(number ?? '') || unknown.length) {
    console.error(
      `Usage: pnpm pr:merge <pull request number> [${WORKFLOW_FLAG}] [${SCHEMA_FLAG}] [${NO_WAIT_FLAG}]`,
    );
    process.exit(2);
  }

  const fields =
    'number,title,state,isDraft,baseRefName,mergeable,reviewDecision,headRefOid,statusCheckRollup,files';
  const pr = JSON.parse(gh(['pr', 'view', number, '--json', fields]));
  const problems = mergeBlockers(pr, {
    workflowChangesReviewed: flags.includes(WORKFLOW_FLAG),
    schemaLagReviewed: flags.includes(SCHEMA_FLAG),
  });
  if (problems.length) {
    console.error(`pr:merge — not merging #${pr.number} "${pr.title}":`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  console.info(`pr:merge — squash-merging #${pr.number} "${pr.title}" at ${pr.headRefOid.slice(0, 7)}`);
  gh(['pr', 'merge', number, '--squash', '--match-head-commit', pr.headRefOid], { stdio: 'inherit' });
  if (!flags.includes(NO_WAIT_FLAG)) await waitForProduction(number);
}

if (process.argv[1] && path.basename(process.argv[1]) === 'pr-merge.mjs') await main();
