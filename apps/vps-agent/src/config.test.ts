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
