import { describe, expect, it } from 'vitest';
import { isPublic } from './public-paths';

describe('isPublic — paths reachable without a session', () => {
  it.each([
    ['/login', true],
    ['/login/anything', true],
    ['/auth/callback', true],
    ['/status/muvmi', true],
    ['/api/cron/engine', true],
    ['/api/ingest', true],
    ['/api/jobs', true],
    ['/', false],
    ['/login-x', false],
    ['/statusX', false],
    ['/auth', false],
    ['/api/other', false],
    ['/api/cronjob', false],
  ])('%s → %s', (path, expected) => {
    expect(isPublic(path)).toBe(expected);
  });
});
