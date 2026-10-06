// Squash-merge a pull request only when it is safe to (D-008).
//
//   pnpm pr:merge <number> [--workflow-changes-reviewed]
//
// The repository is private on GitHub Free, so the ruleset "main" is not enforced and GitHub would
// merge a PR with a red or unfinished CI. This script refuses unless the PR is open, not a draft,
// targets main, has no requested changes, and the CI jobs `check` and `db` succeeded on its current
// head commit, and — when the PR changes CI files that can read repository secrets — the caller passed
// --workflow-changes-reviewed; it then merges that exact commit (`--match-head-commit`), so a push after the check
// can't slip in. No shell: arguments go straight to `gh`.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const REQUIRED_CHECKS = ['check', 'db'];
const FAILED = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);

export const WORKFLOW_FLAG = '--workflow-changes-reviewed';

/** Changed files that run in CI and can read repository secrets (`.github/workflows/`, `.github/actions/`). */
export function ciFiles(pr) {
  return (pr.files ?? []).map((f) => f.path).filter((p) => /^\.github\/(workflows|actions)\//.test(p));
}

/** Reasons the PR must not be merged yet; empty when it may be merged. */
export function mergeBlockers(pr, { workflowChangesReviewed = false } = {}) {
  const problems = [];
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

function main() {
  // pnpm forwards a `--` separator (`pnpm pr:merge 9 -- --flag`); ignore it.
  const [number, ...flags] = process.argv.slice(2).filter((a) => a !== '--');
  const unknown = flags.filter((f) => f !== WORKFLOW_FLAG);
  if (!/^\d+$/.test(number ?? '') || unknown.length) {
    console.error(`Usage: pnpm pr:merge <pull request number> [${WORKFLOW_FLAG}]`);
    process.exit(2);
  }

  const fields =
    'number,title,state,isDraft,baseRefName,mergeable,reviewDecision,headRefOid,statusCheckRollup,files';
  const pr = JSON.parse(gh(['pr', 'view', number, '--json', fields]));
  const problems = mergeBlockers(pr, { workflowChangesReviewed: flags.includes(WORKFLOW_FLAG) });
  if (problems.length) {
    console.error(`pr:merge — not merging #${pr.number} "${pr.title}":`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  console.info(`pr:merge — squash-merging #${pr.number} "${pr.title}" at ${pr.headRefOid.slice(0, 7)}`);
  gh(['pr', 'merge', number, '--squash', '--match-head-commit', pr.headRefOid], { stdio: 'inherit' });
}

if (process.argv[1] && path.basename(process.argv[1]) === 'pr-merge.mjs') main();
