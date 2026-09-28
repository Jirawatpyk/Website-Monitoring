import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const token = 'x'.repeat(32);

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig({ API_BASE_URL: 'https://monitor.example.com', INGEST_TOKEN: token });
    expect(config.VERIFIER_MAX_SESSIONS).toBe(3);
    expect(config.LOOP_INTERVAL_MS).toBe(60_000);
  });

  it('refuses a plain-http API URL outside localhost', () => {
    expect(() => loadConfig({ API_BASE_URL: 'http://monitor.example.com', INGEST_TOKEN: token })).toThrow(
      /API_BASE_URL/,
    );
    expect(loadConfig({ API_BASE_URL: 'http://localhost:3500', INGEST_TOKEN: token }).API_BASE_URL).toBe(
      'http://localhost:3500',
    );
  });

  it('names missing variables without echoing values', () => {
    expect(() => loadConfig({ INGEST_TOKEN: 'short' })).toThrow(/API_BASE_URL, INGEST_TOKEN/);
  });
});
