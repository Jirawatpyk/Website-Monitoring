import { describe, expect, it } from 'vitest';
import { classifyResponse } from './classify';

const res = (status: number, headers: Record<string, string> = {}, bodySample = '') => ({
  status,
  headers: new Headers(headers),
  bodySample,
});

describe('classifyResponse (PRD §5)', () => {
  it.each([
    ['200', res(200), 'pass'],
    ['301 followed to 200 is still a pass', res(200), 'pass'],
    ['404 is not a hard fail', res(404), 'pass'],
    ['500', res(500), 'fail'],
    ['504 (INC-0142 at SIN)', res(504), 'fail'],
    ['403 with cf-mitigated', res(403, { 'cf-mitigated': 'challenge' }), 'blocked'],
    ['429 challenge page body', res(429, {}, '<title>Just a moment...</title>'), 'blocked'],
    ['503 through Cloudflare, no challenge → real outage', res(503, { server: 'cloudflare' }), 'fail'],
    ['504 through Cloudflare', res(504, { server: 'cloudflare' }), 'fail'],
    [
      '503 Cloudflare challenge page',
      res(503, { server: 'cloudflare', 'cf-mitigated': 'challenge' }),
      'blocked',
    ],
    ['503 without a WAF signature', res(503), 'fail'],
    ['plain 403 without a signature', res(403), 'pass'],
  ] as const)('%s → %s', (_name, response, expected) => {
    expect(classifyResponse(response)).toBe(expected);
  });
});
