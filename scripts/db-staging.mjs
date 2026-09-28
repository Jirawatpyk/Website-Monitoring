#!/usr/bin/env node
// Apply migrations to (or rebuild) the STAGING Supabase database without `supabase link`.
//
//   pnpm db:push:staging    → supabase db push  --db-url <staging>
//   pnpm db:reset:staging   → supabase db reset --db-url <staging>   (drops everything, reapplies, seeds)
//
// The connection string comes from `.env.staging.local` (never committed; template:
// scripts/db-staging.env.example). The run is refused unless the URL belongs to the staging project
// and not to production, so a wrong copy-paste can't touch production. Production migrations are
// applied only by CI from `main` (docs/workflow.md → Environments).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/** Throws unless `dbUrl` points at the staging project and not at production. */
export function assertStagingUrl(dbUrl, stagingRef, prodRef) {
  if (!dbUrl) throw new Error('SUPABASE_STAGING_DB_URL is not set');
  if (!stagingRef) throw new Error('SUPABASE_STAGING_PROJECT_REF is not set');
  if (!prodRef) throw new Error('SUPABASE_PROD_PROJECT_REF is not set (needed to refuse production)');
  if (stagingRef === prodRef) throw new Error('Staging and production project refs are the same');

  let url;
  try {
    url = new URL(dbUrl);
  } catch {
    throw new Error('SUPABASE_STAGING_DB_URL is not a valid connection string');
  }
  // Direct: db.<ref>.supabase.co · pooler: user "postgres.<ref>" on *.pooler.supabase.com
  const target = `${decodeURIComponent(url.username)}@${url.hostname}`;
  if (target.includes(prodRef)) throw new Error('Refusing: the connection string points at PRODUCTION');
  if (!target.includes(stagingRef))
    throw new Error('Refusing: the connection string is not the staging project');
  return true;
}

function main() {
  const command = process.argv[2];
  if (command !== 'push' && command !== 'reset') {
    console.error('Usage: node scripts/db-staging.mjs <push|reset>');
    process.exit(2);
  }

  const envFile = path.resolve(import.meta.dirname, '..', '.env.staging.local');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const { SUPABASE_STAGING_DB_URL, SUPABASE_STAGING_PROJECT_REF, SUPABASE_PROD_PROJECT_REF } = process.env;

  try {
    assertStagingUrl(SUPABASE_STAGING_DB_URL, SUPABASE_STAGING_PROJECT_REF, SUPABASE_PROD_PROJECT_REF);
  } catch (err) {
    console.error(`db:${command}:staging — ${err.message}`);
    process.exit(1);
  }

  console.info(`db:${command}:staging → project ${SUPABASE_STAGING_PROJECT_REF}`);
  // Run the CLI's Node entry with this Node — no shell, so characters in the URL are never interpreted.
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve('supabase/package.json');
  const cli = path.join(path.dirname(pkgPath), JSON.parse(readFileSync(pkgPath, 'utf8')).bin.supabase);
  const result = spawnSync(process.execPath, [cli, 'db', command, '--db-url', SUPABASE_STAGING_DB_URL], {
    stdio: 'inherit',
  });
  process.exit(result.status ?? 1);
}

if (process.argv[1] && path.basename(process.argv[1]) === 'db-staging.mjs') main();
