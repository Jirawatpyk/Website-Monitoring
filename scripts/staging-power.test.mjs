import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAGING_PROJECT, stagingChecks, stepsFor } from './staging-power.mjs';

test('only staging checks are paused or resumed, never production ones', () => {
  const checks = [
    { name: 'probe-sin staging' },
    { name: 'Engine', tags: 'staging cron' },
    { name: 'probe-sin' },
    { name: 'Notifier', tags: 'prod' },
  ];
  assert.deepEqual(
    stagingChecks(checks).map((c) => c.name),
    ['probe-sin staging', 'Engine'],
  );
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
