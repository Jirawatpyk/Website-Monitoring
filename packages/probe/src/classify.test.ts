import { describe, expect, it } from 'vitest';
import { classifyResponse, wafSignature } from './classify';

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

// The Akamai block page Bangkok Airways answered SIN / TYO with (docs/phase0/bangkokair-403.txt).
const AKAMAI_PAGE = `<HTML><HEAD>\n<TITLE>Access Denied</TITLE>\n</HEAD><BODY>\n<H1>Access Denied</H1>\n You don't have permission to access "http&#58;&#47;&#47;www&#46;bangkokair&#46;com&#47;twn" on this server.<P>\nReference&#32;&#35;18&#46;4c0c133d&#46;1791178397&#46;4e22cfbd\n</BODY>\n</HTML>`;

describe('wafSignature (D-027)', () => {
  it.each([
    ['Akamai 403: AkamaiGHost + Access Denied', res(403, { server: 'AkamaiGHost' }, AKAMAI_PAGE), 'akamai'],
    [
      'Akamai 403: Reference # alone',
      res(403, { server: 'AkamaiGHost' }, 'Reference&#32;&#35;18&#46;4c0c'),
      'akamai',
    ],
    ['Cloudflare challenge', res(403, { 'cf-mitigated': 'challenge' }), 'cloudflare'],
    ['Sucuri block', res(403, { 'x-sucuri-block': '1' }), 'sucuri'],
    ['"Access Denied" body without the Akamai server header', res(403, {}, AKAMAI_PAGE), null],
    [
      'AkamaiGHost header without the block page',
      res(403, { server: 'AkamaiGHost' }, '<h1>Forbidden</h1>'),
      null,
    ],
    ['a captcha page body only', res(429, {}, '<title>Just a moment...</title>'), null],
    ['a 200 through Akamai', res(200, { server: 'AkamaiGHost' }, 'Access Denied'), null],
    ['a 5xx through Akamai is an outage, not a WAF', res(502, { server: 'AkamaiGHost' }), null],
  ] as const)('%s → %s', (_name, response, expected) => {
    expect(wafSignature(response)).toBe(expected);
  });

  it('an Akamai block is blocked; a plain 403 keeps the D-022 rule (a pass)', () => {
    expect(classifyResponse(res(403, { server: 'AkamaiGHost' }, AKAMAI_PAGE))).toBe('blocked');
    expect(classifyResponse(res(403, { server: 'AkamaiGHost' }, '<h1>Forbidden</h1>'))).toBe('pass');
  });
});
