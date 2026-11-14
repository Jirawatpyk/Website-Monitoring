import { describe, expect, it } from 'vitest';
import { deviceLabel } from './device';

describe('deviceLabel (D-062 item 12)', () => {
  it.each([
    // Real browser strings, the forms Auth records once the web app forwards them.
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Chrome · macOS',
      'Laptop',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      'Edge · Windows',
      'Laptop',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
      'Firefox · Windows',
      'Laptop',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      'Safari · iPhone',
      'Phone',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
      'Chrome · iPhone',
      'Phone',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
      'Samsung Internet · Android',
      'Phone',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
      'Chrome · Android',
      'Phone',
    ],
    [
      'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
      'Safari · iPad',
      'Tablet',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
      'Safari · macOS',
      'Laptop',
    ],
  ])('%s → %s', (ua, name, tag) => {
    expect(deviceLabel(ua)).toEqual({ name, tag });
  });

  it.each([
    ['node'], // what staging's sessions hold from before the forwarding (server-side exchange)
    [''],
    [null],
    [undefined],
    ['curl/8.4.0'],
  ])('%s → Unknown device', (ua) => {
    expect(deviceLabel(ua)).toEqual({ name: 'Unknown device', tag: null });
  });
});
