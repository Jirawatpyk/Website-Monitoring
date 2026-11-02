#!/usr/bin/env node
// Pause the whole staging environment between test runs, and bring it back before one.
//
//   pnpm staging:pause  → Healthchecks staging checks paused → dxt-agent@staging stopped → Vercel project paused
//   pnpm staging:resume → Vercel project unpaused → wait until it answers → dxt-agent@staging started
//                         → Healthchecks staging checks resumed
//
// Why: staging's crons run every minute like production's and cost about as much Fluid memory
// (Tao, 2 Nov 2026), though staging is only used while testing. The order keeps it quiet: the agent
// stops before Vercel does (else it pings Healthchecks /fail), and the checks are paused first (else
// each one emails "down"). The project id is fixed here: this script can never pause production.
// Needs: the Vercel CLI signed in to the team, the VPS key (~/.ssh/dxt_vps, as deploy/release.sh), and
// HEALTHCHECKS_API_KEY in `.env.staging.local` (never committed; read at run time only).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const STAGING_PROJECT = 'prj_WlfDfQ0sF9kWW1PtqVWYFINA2KSg';
export const TEAM = 'team_KLEKhF6PuSAbJSmgDpyEXES4';
export const STAGING_URL = 'https://monitor-staging.dxtspace.com/';
const VPS = process.env.DXT_VPS ?? 'root@38.60.233.62';
const VPS_KEY = process.env.DXT_VPS_KEY ?? path.join(os.homedir(), '.ssh', 'dxt_vps');
const HC_API = 'https://healthchecks.io/api/v3/checks/';

/** Staging's Healthchecks checks: those whose name or tags say staging (production's never do). */
export function stagingChecks(checks) {
  return checks.filter((c) => /staging/i.test(`${c.name ?? ''} ${c.tags ?? ''}`));
}

/** The steps in order, as `[kind, action]` — the order is the point (see the header). */
export function stepsFor(command) {
  if (command === 'pause')
    return [
      ['healthchecks', 'pause'],
      ['agent', 'stop'],
      ['vercel', 'pause'],
    ];
  if (command === 'resume')
    return [
      ['vercel', 'unpause'],
      ['wait', 'ready'],
      ['agent', 'start'],
      ['healthchecks', 'resume'],
    ];
  throw new Error(`Unknown command: ${command}`);
}

function run(file, args) {
  // The Vercel CLI is a .cmd shim on Windows; every argument here is a constant of this file.
  const r = spawnSync(file, args, { encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`${file} ${args[0]} failed: ${(r.stderr || r.stdout || '').trim()}`);
  return r.stdout;
}

async function healthchecks(action, apiKey) {
  const list = await fetch(HC_API, { headers: { 'X-Api-Key': apiKey } });
  if (!list.ok) throw new Error(`Healthchecks list: HTTP ${list.status}`);
  const checks = stagingChecks((await list.json()).checks ?? []);
  if (!checks.length) throw new Error('Healthchecks: no check named "staging" in this project');
  for (const c of checks) {
    const id = c.uuid ?? c.unique_key;
    const res = await fetch(`${HC_API}${id}/${action}`, { method: 'POST', headers: { 'X-Api-Key': apiKey } });
    if (!res.ok) throw new Error(`Healthchecks ${action} "${c.name}": HTTP ${res.status}`);
  }
  return `${checks.length} check(s) ${action}d: ${checks.map((c) => c.name).join(', ')}`;
}

async function waitReady(timeoutMs = 180_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const res = await fetch(STAGING_URL, { redirect: 'manual' }).catch(() => null);
    if (res && res.status < 500) return `answers HTTP ${res.status}`;
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error(`${STAGING_URL} didn't answer within ${timeoutMs / 1000} s`);
}

async function main() {
  const command = process.argv[2];
  let steps;
  try {
    steps = stepsFor(command);
  } catch {
    console.error('Usage: node scripts/staging-power.mjs <pause | resume>');
    process.exit(2);
  }
  const envFile = path.resolve(import.meta.dirname, '..', '.env.staging.local');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const apiKey = process.env.HEALTHCHECKS_API_KEY;
  if (!apiKey) {
    console.error(`staging:${command} — HEALTHCHECKS_API_KEY is not set in .env.staging.local`);
    process.exit(1);
  }

  for (const [kind, action] of steps) {
    try {
      let out;
      if (kind === 'healthchecks') out = await healthchecks(action, apiKey);
      else if (kind === 'agent')
        out = run('ssh', [
          '-i',
          VPS_KEY,
          VPS,
          `systemctl ${action === 'stop' ? 'disable' : 'enable'} --now dxt-agent@staging && systemctl is-active dxt-agent@staging || true`,
        ]).trim();
      else if (kind === 'vercel')
        out =
          run('vercel', [
            'api',
            `/v1/projects/${STAGING_PROJECT}/${action}?teamId=${TEAM}`,
            '--method',
            'POST',
          ]).trim() || 'ok';
      else out = await waitReady();
      console.info(`staging:${command} — ${kind} ${action}: ${out}`);
    } catch (err) {
      console.error(`staging:${command} — ${kind} ${action} FAILED: ${err.message}`);
      process.exit(1);
    }
  }
}

if (process.argv[1] && path.basename(process.argv[1]) === 'staging-power.mjs') await main();
