#!/usr/bin/env node
// Audit coverage (plan S15 Done-when 1, D-061 item 4): every server action and API route that can
// change config or incident state writes `audit_log`, and slices after S15 are held to it.
//
// Two halves:
// - The database: supabase/tests/audit_coverage.test.sql lists every volatile public function that
//   `authenticated` or `service_role` can execute as `audited` (naming the pgTAP test that checks its
//   row) or `exempt` (with the reason). pgTAP fails on a function missing from the list.
// - The web app (this script): every export of a 'use server' file and every route handler under
//   apps/web/src/app is in apps/web/audit-coverage.json, either with the audited database functions
//   it writes through (each must be `audited` in the list and called from its file or the files it
//   imports) or `exempt` with the reason. No source file writes a table directly unless an audit
//   trigger covers that table.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
export const PATHS = {
  src: path.join(ROOT, 'apps', 'web', 'src'),
  registry: path.join(ROOT, 'apps', 'web', 'audit-coverage.json'),
  classes: path.join(ROOT, 'supabase', 'tests', 'audit_coverage.test.sql'),
  tests: path.join(ROOT, 'supabase', 'tests'),
  migrations: path.join(ROOT, 'supabase', 'migrations'),
};

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const IS_TEST = /\.(test|int\.test|spec)\.tsx?$/;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
    return /\.tsx?$/.test(e.name) && !IS_TEST.test(e.name) ? [p] : [];
  });
}

const rel = (src, file) => path.relative(src, file).split(path.sep).join('/');
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

/** `'use server'` files' exports and route handlers, as `file#name` → absolute file. */
export function entryPoints(src) {
  const out = new Map();
  for (const file of walk(src)) {
    const code = stripComments(fs.readFileSync(file, 'utf8'));
    const r = rel(src, file);
    const names = exportedNames(code);
    if (/^\s*['"]use server['"]/.test(code)) {
      for (const name of names) out.set(`${r}#${name}`, file);
    }
    if (/(^|\/)route\.ts$/.test(r)) {
      for (const name of names) if (METHODS.includes(name)) out.set(`${r}#${name}`, file);
    }
  }
  return out;
}

/**
 * Every name a module exports: `export (async) function x`, `export const x =`, and the list form
 * `export { a, b as POST }` / `export { GET } from './x'` (review: a re-exported handler must not
 * slip past the check). Type-only exports are left out.
 */
export function exportedNames(code) {
  const names = new Set();
  for (const m of code.matchAll(
    /export\s+(?:async\s+)?(?:function\s*\*?\s*(\w+)|(?:const|let|var)\s+(\w+)\s*=)/g,
  )) {
    names.add(m[1] ?? m[2]);
  }
  for (const m of code.matchAll(/export\s+(type\s+)?\{([^}]*)\}/g)) {
    if (m[1]) continue;
    for (const part of m[2].split(',')) {
      const p = part.trim();
      if (!p || p.startsWith('type ')) continue;
      const as = p.match(/\bas\s+(\w+)$/);
      names.add(as ? as[1] : p);
    }
  }
  return names;
}

/** The file an import names, inside src: `@/x`, `./x`, `../x` (.ts, .tsx, /index.ts). */
function resolveImport(src, from, spec) {
  let base;
  if (spec.startsWith('@/')) base = path.join(src, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const c of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

/**
 * Every database function name called as `.rpc('name'` from `file` or anything it imports. Per
 * file, not per exported function: two actions in one actions.ts reach the same set, so the
 * registry's `rpc` list is the per-action claim and review keeps it honest (known limit, S15 review).
 */
export function reachableRpcs(src, file, cache = new Map()) {
  const seen = new Set();
  const rpcs = new Set();
  const stack = [file];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    let code = cache.get(f);
    if (code === undefined) {
      code = stripComments(fs.readFileSync(f, 'utf8'));
      cache.set(f, code);
    }
    for (const m of code.matchAll(/\brpc\(\s*['"]([a-z_0-9]+)['"]/g)) rpcs.add(m[1]);
    for (const m of code.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const next = resolveImport(src, f, m[1]);
      if (next && !IS_TEST.test(next)) stack.push(next);
    }
  }
  return rpcs;
}

/** `('fn', 'audited' | 'exempt', 'test file | reason')` rows of the pgTAP list. */
export function parseClasses(sql) {
  const out = new Map();
  for (const m of sql.matchAll(/\(\s*'([a-z_0-9]+)'\s*,\s*'(audited|exempt)'\s*,\s*'((?:[^']|'')*)'\s*\)/g)) {
    out.set(m[1], { kind: m[2], note: m[3].replaceAll("''", "'") });
  }
  return out;
}

/** Tables an audit trigger covers (`private.audit_row_change`), read from the migrations. */
export function auditedTables(migrationsDir) {
  const out = new Set();
  for (const f of fs.readdirSync(migrationsDir).filter((n) => n.endsWith('.sql'))) {
    const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    for (const m of sql.matchAll(
      /on\s+public\.([a-z_]+)\s+for each row execute function private\.audit_row_change/g,
    )) {
      out.add(m[1]);
    }
  }
  return out;
}

/** Direct table writes in source: `.from('t').insert|update|upsert|delete(`. */
export function directWrites(src) {
  const out = [];
  for (const file of walk(src)) {
    const code = stripComments(fs.readFileSync(file, 'utf8'));
    for (const m of code.matchAll(/\.from\(\s*['"]([a-z_]+)['"]\s*\)\s*\.(insert|update|upsert|delete)\(/g)) {
      out.push({ file: rel(src, file), table: m[1], op: m[2] });
    }
  }
  return out;
}

/** Every problem, as one line each; empty when the coverage holds. */
export function checkAuditCoverage({ src, registry, classes, tests, migrations }) {
  const errors = [];
  const entries = entryPoints(src);
  const reg = { ...(registry.actions ?? {}), ...(registry.routes ?? {}) };
  const cache = new Map();

  for (const [key, file] of entries) {
    const r = reg[key];
    if (!r) {
      errors.push(
        `${key}: not in apps/web/audit-coverage.json — list the audited database functions it writes through, or "exempt" with the reason`,
      );
      continue;
    }
    if (typeof r.exempt === 'string') {
      if (r.exempt.trim().length < 15) errors.push(`${key}: "exempt" needs a reason (a sentence)`);
      continue;
    }
    if (!Array.isArray(r.rpc) || r.rpc.length === 0) {
      errors.push(`${key}: give "rpc" (the audited functions it writes through) or "exempt"`);
      continue;
    }
    const reach = reachableRpcs(src, file, cache);
    for (const fn of r.rpc) {
      const c = classes.get(fn);
      if (!c) errors.push(`${key}: ${fn} is not in supabase/tests/audit_coverage.test.sql`);
      else if (c.kind !== 'audited')
        errors.push(`${key}: ${fn} is exempt there (${c.note}) — it doesn't write audit_log`);
      if (!reach.has(fn))
        errors.push(`${key}: ${fn} isn't called from ${rel(src, file)} or the files it imports`);
    }
  }
  for (const key of Object.keys(reg)) {
    if (!entries.has(key)) errors.push(`${key}: in apps/web/audit-coverage.json but no such action or route`);
  }

  for (const [fn, c] of classes) {
    if (c.kind === 'exempt') {
      if (c.note.trim().length < 15) errors.push(`audit_coverage.test.sql: ${fn} — exempt needs a reason`);
      continue;
    }
    const file = path.join(tests, c.note);
    if (!fs.existsSync(file)) {
      errors.push(`audit_coverage.test.sql: ${fn} — the test "${c.note}" doesn't exist`);
      continue;
    }
    const sql = fs.readFileSync(file, 'utf8');
    if (!new RegExp(`\\b${fn}\\b`).test(sql) || !/\baudit_log\b/.test(sql)) {
      errors.push(`audit_coverage.test.sql: ${fn} — ${c.note} must call it and read audit_log`);
    }
  }

  // A direct write is fine on a table an audit trigger covers, or on one listed in "directWrites"
  // with the reason (monitoring data and delivery state the service role keeps).
  const covered = auditedTables(migrations);
  const allowed = registry.directWrites ?? {};
  for (const [table, why] of Object.entries(allowed)) {
    if (typeof why !== 'string' || why.trim().length < 15)
      errors.push(`directWrites.${table}: needs a reason`);
  }
  for (const w of directWrites(src)) {
    if (!covered.has(w.table) && !(w.table in allowed)) {
      errors.push(
        `${w.file}: writes ${w.table} directly (${w.op}) — go through a database function that writes audit_log, or list the table in "directWrites" with the reason`,
      );
    }
  }
  return errors;
}

function main() {
  const errors = checkAuditCoverage({
    src: PATHS.src,
    registry: JSON.parse(fs.readFileSync(PATHS.registry, 'utf8')),
    classes: parseClasses(fs.readFileSync(PATHS.classes, 'utf8')),
    tests: PATHS.tests,
    migrations: PATHS.migrations,
  });
  if (errors.length === 0) {
    console.info(`audit coverage: ${entryPoints(PATHS.src).size} actions and routes classified`);
    return;
  }
  for (const e of errors) console.error(e);
  console.error(`\n${errors.length} audit coverage problem(s) (plan S15, D-061).`);
  process.exit(1);
}

if (process.argv[1] && path.basename(process.argv[1]) === 'check-audit-coverage.mjs') {
  if (process.argv.includes('--print')) {
    const cache = new Map();
    for (const [key, file] of entryPoints(PATHS.src)) {
      console.info(`${key}\t${[...reachableRpcs(PATHS.src, file, cache)].sort().join(' ')}`);
    }
  } else main();
}
