import { describe, expect, it } from 'vitest';
import { isAllowedEmail, parseAllowedDomains, safeNextPath } from './auth';

describe('safeNextPath', () => {
  it.each([
    ['/incidents/INC-0142?ack=1', '/incidents/INC-0142?ack=1'],
    ['/', '/'],
    [null, '/'],
    ['', '/'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['/\t/evil.example', '/'],
    ['/\n/evil.example', '/'],
    ['javascript:alert(1)', '/'],
    ['/login', '/'],
    ['/login?next=%2Fx', '/'],
    ['/auth/callback?code=x', '/'],
    ['/login-history', '/login-history'],
    ['/authors', '/authors'],
  ])('%j → %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});

describe('isAllowedEmail', () => {
  it.each([
    ['tao@dxt.co.th', 'dxt.co.th', true],
    ['Tao@DXT.CO.TH', 'dxt.co.th', true],
    ['tao@gmail.com', 'dxt.co.th', false],
    ['tao@dxt.co.th.evil.com', 'dxt.co.th', false],
    ['tao@sub.dxt.co.th', 'dxt.co.th', false],
    ['@dxt.co.th', 'dxt.co.th', false],
    ['tao@dxt.co.th', '', false],
    ['tao@dxt.co.th', undefined, false],
    [undefined, 'dxt.co.th', false],
    // Several domains (D-007): a colleague whose primary address is on the group's domain.
    ['fluke@omg-group.asia', 'eqho.com,omg-group.asia', true],
    ['tao@eqho.com', ' eqho.com , omg-group.asia ', true],
    ['tao@evil.com', 'eqho.com,omg-group.asia', false],
    ['tao@omg-group.asia.evil.com', 'eqho.com,omg-group.asia', false],
    ['tao@eqho.com', ',', false],
  ])('%s with %s → %s', (email, domain, expected) => {
    expect(isAllowedEmail(email, domain)).toBe(expected);
  });
});

describe('parseAllowedDomains', () => {
  it.each([
    ['eqho.com', ['eqho.com']],
    ['Eqho.com, OMG-Group.asia', ['eqho.com', 'omg-group.asia']],
    [' , ,', []],
    [undefined, []],
  ])('%j → %j', (value, expected) => {
    expect(parseAllowedDomains(value)).toEqual(expected);
  });
});
