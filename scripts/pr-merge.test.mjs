import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeBlockers } from './pr-merge.mjs';

const green = {
  state: 'OPEN',
  isDraft: false,
  baseRefName: 'main',
  mergeable: 'MERGEABLE',
  reviewDecision: '',
  statusCheckRollup: [
    { name: 'check', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'migrate-production', status: 'COMPLETED', conclusion: 'SKIPPED' },
  ],
};

test('a green, open PR against main may be merged', () => {
  assert.deepEqual(mergeBlockers(green), []);
});

test('refuses while CI check is running, failed or missing', () => {
  const running = { ...green, statusCheckRollup: [{ name: 'check', status: 'IN_PROGRESS', conclusion: '' }] };
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
      { name: 'db', status: 'COMPLETED', conclusion: 'FAILURE' },
    ],
  };
  assert.match(mergeBlockers(pr).join(), /"db" ended FAILURE/);
});

test('refuses drafts, closed PRs, other bases, conflicts and requested changes', () => {
  assert.equal(mergeBlockers({ ...green, isDraft: true }).length, 1);
  assert.equal(mergeBlockers({ ...green, state: 'MERGED' }).length, 1);
  assert.equal(mergeBlockers({ ...green, baseRefName: 'staging' }).length, 1);
  assert.equal(mergeBlockers({ ...green, mergeable: 'CONFLICTING' }).length, 1);
  assert.equal(mergeBlockers({ ...green, reviewDecision: 'CHANGES_REQUESTED' }).length, 1);
});
