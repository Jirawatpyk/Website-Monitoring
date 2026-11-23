// `pnpm dev:e2e` — the web app as CI's e2e runs it: `next build` + `next start` on :3500, against the local
// Supabase stack, with the local-only values of the `web-local-db` launch config (.claude/launch.json;
// they're the stack's public defaults, not secrets).
//
// Why not `pnpm dev`: under parallel specs Next's dev server drops the RSC stream a server action
// returns ("The destination stream errored while writing data"): the action saves, the page never
// updates, and 5 signed-in specs failed on every local run while the same specs never fail against
// `next start` (23 Nov 2026: full suite 122 passed, no retry). Playwright reuses this server on :3500.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const launch = JSON.parse(fs.readFileSync(path.join(root, '.claude/launch.json'), 'utf8'));
const local = launch.configurations.find((c) => c.name === 'web-local-db');
if (!local?.env) throw new Error('web-e2e-server: no "web-local-db" env in .claude/launch.json');
const env = { ...process.env, ...local.env };
const web = path.join(root, 'apps/web');
const run = (args) =>
  spawnSync('pnpm', ['exec', 'next', ...args], { cwd: web, env, stdio: 'inherit', shell: true });

if (!process.argv.includes('--no-build')) {
  const built = run(['build']);
  if (built.status !== 0) process.exit(built.status ?? 1);
}
const server = spawn('pnpm', ['exec', 'next', 'start', '--port', '3500'], {
  cwd: web,
  env,
  stdio: 'inherit',
  shell: true,
});
server.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.kill(sig));
