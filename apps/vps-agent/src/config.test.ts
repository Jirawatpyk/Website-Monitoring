import { describe, expect, it } from 'vitest';
import { DEFAULT_AKAMAI_CONTROL_URL, loadConfig } from './config';

const token = 'x'.repeat(32);

describe('AKAMAI_CONTROL_URL (D-027 rule 2b)', () => {
  it('defaults when unset or blank, takes an https URL, refuses http', () => {
    const base = { API_BASE_URL: 'https://monitor.example.test', INGEST_TOKEN: token };
    expect(loadConfig(base).AKAMAI_CONTROL_URL).toBe(DEFAULT_AKAMAI_CONTROL_URL);
    expect(loadConfig({ ...base, AKAMAI_CONTROL_URL: ' ' }).AKAMAI_CONTROL_URL).toBe(
      DEFAULT_AKAMAI_CONTROL_URL,
    );
    expect(loadConfig({ ...base, AKAMAI_CONTROL_URL: 'https://a.example/x' }).AKAMAI_CONTROL_URL).toBe(
      'https://a.example/x',
    );
    expect(() => loadConfig({ ...base, AKAMAI_CONTROL_URL: 'http://a.example/' })).toThrow();
  });
});

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

  it('control URLs (D-027): two providers by default, https only, two or three', () => {
    const base = { API_BASE_URL: 'https://monitor.example.com', INGEST_TOKEN: token };
    expect(loadConfig(base).CONTROL_URLS).toEqual([
      'https://www.gstatic.com/generate_204',
      'https://www.cloudflare.com/cdn-cgi/trace',
    ]);
    expect(
      loadConfig({ ...base, CONTROL_URLS: 'https://a.example.com/ok, https://b.example.net/ok' })
        .CONTROL_URLS,
    ).toEqual(['https://a.example.com/ok', 'https://b.example.net/ok']);
    expect(loadConfig({ ...base, CONTROL_URLS: '' }).CONTROL_URLS).toHaveLength(2);
    expect(() => loadConfig({ ...base, CONTROL_URLS: 'https://only-one.example.com' })).toThrow(
      /CONTROL_URLS/,
    );
    expect(() =>
      loadConfig({ ...base, CONTROL_URLS: 'http://a.example.com, https://b.example.com' }),
    ).toThrow(/CONTROL_URLS/);
  });

  it('names missing variables without echoing values', () => {
    expect(() => loadConfig({ INGEST_TOKEN: 'short' })).toThrow(/API_BASE_URL, INGEST_TOKEN/);
  });
});

describe('deploy/package.json', () => {
  it('installs the same Playwright the agent is built and tested with', async () => {
    const { readFile } = await import('node:fs/promises');
    const read = async (path: string) =>
      JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8')) as {
        dependencies: Record<string, string>;
      };
    const [agent, runtime] = await Promise.all([read('../package.json'), read('../deploy/package.json')]);
    expect(runtime.dependencies).toEqual({ playwright: agent.dependencies.playwright });
  });
});

describe('deploy/dxt-agent@.service', () => {
  it('runs each instance from its own release folder with the shared browsers (S04b)', async () => {
    const { readFile } = await import('node:fs/promises');
    const unit = await readFile(new URL('../deploy/dxt-agent@.service', import.meta.url), 'utf8');
    // A shared /opt/dxt-agent meant a staging release changed what production ran after a restart.
    expect(unit).toMatch(/^WorkingDirectory=\/opt\/dxt-agent\/%i$/m);
    expect(unit).toMatch(/^Environment=PLAYWRIGHT_BROWSERS_PATH=\/opt\/dxt-agent\/browsers$/m);
    expect(unit).toMatch(/^ExecStart=.* dist\/index\.js$/m);
  });
});

describe('deploy/dxt-agent@.service thread pool (D-039)', () => {
  it('gives libuv at least 16 threads, so a round of checks doesn’t queue its DNS lookups', async () => {
    const { readFile } = await import('node:fs/promises');
    const unit = await readFile(new URL('../deploy/dxt-agent@.service', import.meta.url), 'utf8');
    const size = Number(/^Environment=UV_THREADPOOL_SIZE=(\d+)$/m.exec(unit)?.[1]);
    expect(size).toBeGreaterThanOrEqual(16);
  });
});

describe('the bundle (tsup.config.ts)', () => {
  it('keeps external only what deploy/package.json installs on the VPS', async () => {
    const { readFile } = await import('node:fs/promises');
    const { default: tsup } = await import('../tsup.config');
    const read = async (path: string) =>
      JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8')) as {
        dependencies: Record<string, string>;
      };
    const [agent, runtime] = await Promise.all([read('../package.json'), read('../deploy/package.json')]);
    const bundled = (tsup as { noExternal: (string | RegExp)[] }).noExternal;
    const isBundled = (name: string) =>
      bundled.some((p) => (typeof p === 'string' ? p === name : p.test(name)));
    // Seen on the VPS (S03): zod stayed external and the agent couldn't start.
    const missing = Object.keys(agent.dependencies).filter(
      (d) => !isBundled(d) && !(d in runtime.dependencies),
    );
    expect(missing).toEqual([]);
  });
});
