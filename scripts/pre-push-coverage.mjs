#!/usr/bin/env node
// Run `test:coverage` for the workspace packages a push changes — called by .githooks/pre-push after
// `pnpm check`, with the pushed commits as arguments.
//
//   node scripts/pre-push-coverage.mjs <sha>…
//
// Why: `pnpm check` runs `test`, not `test:coverage`, so a package's coverage threshold was only enforced
// in CI — S11 PR B passed the hook and then failed CI on notifier branch coverage (retro 3 Nov 2026,
// PR #164). Only the packages the branch touches run, to keep the push fast; a change in one package that
// lowers another's coverage is still left to CI.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

/**
 * The workspace packages (`apps/<name>`, `packages/<name>`) that the changed paths fall inside and that
 * have a `test:coverage` script (`packages/db` has none: `pnpm --filter` would fail on it), by package
 * name, sorted. `readPackageJson(dir)` returns the parsed package.json of a directory, or null.
 */
export function coveragePackagesFor(changedPaths, readPackageJson) {
  const names = new Set();
  for (const file of changedPaths) {
    const match = /^(apps|packages)\/([^/]+)\//.exec(file.replaceAll('\\', '/'));
    if (!match) continue;
    const pkg = readPackageJson(`${match[1]}/${match[2]}`);
    if (pkg?.name && pkg.scripts?.['test:coverage']) names.add(pkg.name);
  }
  return [...names].sort();
}

/** The `pnpm` arguments that run `test:coverage` in those packages, or null when there are none. */
export function coverageArgs(names) {
  return names.length ? [...names.flatMap((n) => ['--filter', n]), 'test:coverage'] : null;
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

/** origin/main as last fetched (the hook never fetches), else the local main. */
function baseRef() {
  for (const ref of ['origin/main', 'main']) {
    try {
      git(['rev-parse', '--verify', '-q', `${ref}^{commit}`]);
      return ref;
    } catch {
      // try the next one
    }
  }
  return null;
}

function readPackageJson(dir) {
  try {
    return JSON.parse(readFileSync(path.join(root, dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

function main() {
  const shas = process.argv.slice(2).filter((a) => a !== '--');
  const base = baseRef();
  if (!base) {
    console.error('pre-push: no main or origin/main to compare with — skipping test:coverage.');
    return;
  }
  const changed = new Set();
  for (const sha of shas) {
    // Three dots: everything on the pushed branch since it left main.
    for (const file of git(['diff', '--name-only', `${base}...${sha}`]).split('\n')) {
      if (file) changed.add(file);
    }
  }
  const names = coveragePackagesFor(changed, readPackageJson);
  const args = coverageArgs(names);
  if (!args) return;
  console.error(`pre-push: running test:coverage in ${names.join(', ')}…`);
  // pnpm is a .cmd shim on Windows, which spawnSync runs only through a shell.
  const result = spawnSync('pnpm', args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && path.basename(process.argv[1]) === 'pre-push-coverage.mjs') main();
