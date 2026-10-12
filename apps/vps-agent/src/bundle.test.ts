import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

// The tests run the TypeScript source; the VPS runs tsup's bundle. A CommonJS dependency inlined into
// the ESM bundle (undici, D-040) built fine and died on start with "Dynamic require of "assert" is not
// supported" — so build the bundle and start it (security review, 13 Oct 2026).
const agentDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Inside the package, so the external Playwright resolves from its node_modules as on the VPS.
const outDir = mkdtempSync(path.join(agentDir, '.bundle-test-'));
afterAll(() => rmSync(outDir, { recursive: true, force: true }));

describe('the built bundle (tsup)', () => {
  it('loads every module and reaches its own config check', { timeout: 120_000 }, async () => {
    const { build } = await import('tsup');
    const { default: config } = await import('../tsup.config');
    await build({ ...(config as object), outDir, silent: true, sourcemap: false });
    // No environment: a bundle that loads stops at loadConfig; one that can't load never gets there.
    const run = spawnSync(process.execPath, [path.join(outDir, 'index.js')], {
      cwd: agentDir,
      env: { PATH: process.env.PATH ?? '' },
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(run.stderr).not.toMatch(/Dynamic require|Cannot find module|ERR_MODULE_NOT_FOUND/);
    expect(run.stderr).toMatch(/Invalid agent environment/);
  });
});
