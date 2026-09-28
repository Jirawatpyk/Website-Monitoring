import { describe, expect, it } from 'vitest';
import { hasBearer } from './bearer';

const secret = 's'.repeat(32);
const request = (authorization?: string) =>
  new Request('https://monitor.example.com/api/cron/engine', {
    headers: authorization ? { authorization } : {},
  });

describe('hasBearer', () => {
  it('accepts the exact bearer token', () => {
    expect(hasBearer(request(`Bearer ${secret}`), secret)).toBe(true);
  });

  it.each([
    ['missing header', undefined],
    ['wrong token', `Bearer ${'x'.repeat(32)}`],
    ['shorter token', `Bearer ${secret.slice(1)}`],
    ['no scheme', secret],
    ['lower-case scheme', `bearer ${secret}`],
  ])('refuses %s', (_name, header) => {
    expect(hasBearer(request(header), secret)).toBe(false);
  });
});
