import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAGING_PROJECT, stagingChecks, stepsFor } from './staging-power.mjs';

test('the staging key sees only staging checks: all of them are paused or resumed', () => {
  const checks = [{ name: 'probe-sin' }, { name: 'engine' }, { name: 'browser-verifier' }];
  assert.deepEqual(stagingChecks(checks), checks);
});

test('a key that sees production checks is refused (the wrong key pasted)', () => {
  assert.throws(() => stagingChecks([{ name: 'engine' }, { name: 'probe-sin', tags: 'prod' }]), /production/);
});

test('pause quiets alerts before stopping anything; resume starts the agent only once Vercel answers', () => {
  assert.deepEqual(
    stepsFor('pause').map(([k]) => k),
    ['healthchecks', 'agent', 'vercel'],
  );
  assert.deepEqual(
    stepsFor('resume').map(([k]) => k),
    ['vercel', 'wait', 'agent', 'healthchecks'],
  );
  assert.throws(() => stepsFor('delete'));
});

test('the project is the staging one (production can never be paused from here)', () => {
  assert.equal(STAGING_PROJECT, 'prj_WlfDfQ0sF9kWW1PtqVWYFINA2KSg');
});
