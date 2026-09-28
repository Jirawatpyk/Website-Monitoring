// Squash-merge a pull request only when it is safe to (D-008).
//
//   pnpm pr:merge <number>
//
// The repository is private on GitHub Free, so the ruleset "main" is not enforced and GitHub would
// merge a PR with a red or unfinished CI. This script refuses unless the PR is open, not a draft,
// targets main, has no requested changes, and the CI job `check` succeeded on its current head
// commit; it then merges that exact commit (`--match-head-commit`), so a push after the check
// can't slip in. No shell: arguments go straight to `gh`.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const REQUIRED_CHECK = 'check';
const FAILED = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);

/** Reasons the PR must not be merged yet; empty when it may be merged. */
export function mergeBlockers(pr) {
  const problems = [];
  if (pr.state !== 'OPEN') problems.push(`the PR is ${pr.state.toLowerCase()}`);
  if (pr.isDraft) problems.push('the PR is a draft');
  if (pr.baseRefName !== 'main') problems.push(`it targets ${pr.baseRefName}, not main`);
  if (pr.mergeable === 'CONFLICTING') problems.push('it has merge conflicts with main');
  else if (pr.mergeable !== 'MERGEABLE')
    problems.push('GitHub has not finished checking for conflicts — run again in a moment');
  if (pr.reviewDecision === 'CHANGES_REQUESTED') problems.push('a reviewer requested changes');

  const checks = pr.statusCheckRollup ?? [];
  const required = checks.filter((c) => c.name === REQUIRED_CHECK);
  if (required.length === 0) problems.push(`CI "${REQUIRED_CHECK}" has not run on the head commit`);
  for (const c of required) {
    if (c.status !== 'COMPLETED') problems.push(`CI "${REQUIRED_CHECK}" is still ${c.status.toLowerCase()}`);
    else if (c.conclusion !== 'SUCCESS') problems.push(`CI "${REQUIRED_CHECK}" ended ${c.conclusion}`);
  }
  for (const c of checks) {
    if (c.name !== REQUIRED_CHECK && c.status === 'COMPLETED' && FAILED.has(c.conclusion)) {
      problems.push(`check "${c.name}" ended ${c.conclusion}`);
    }
  }
  return problems;
}

function gh(args, options = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', ...options });
}

function main() {
  const number = process.argv[2];
  if (!/^\d+$/.test(number ?? '')) {
    console.error('Usage: pnpm pr:merge <pull request number>');
    process.exit(2);
  }

  const fields =
    'number,title,state,isDraft,baseRefName,mergeable,reviewDecision,headRefOid,statusCheckRollup';
  const pr = JSON.parse(gh(['pr', 'view', number, '--json', fields]));
  const problems = mergeBlockers(pr);
  if (problems.length) {
    console.error(`pr:merge — not merging #${pr.number} "${pr.title}":`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  console.info(`pr:merge — squash-merging #${pr.number} "${pr.title}" at ${pr.headRefOid.slice(0, 7)}`);
  gh(['pr', 'merge', number, '--squash', '--match-head-commit', pr.headRefOid], { stdio: 'inherit' });
}

if (process.argv[1] && path.basename(process.argv[1]) === 'pr-merge.mjs') main();
