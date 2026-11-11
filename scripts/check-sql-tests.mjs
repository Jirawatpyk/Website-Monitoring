#!/usr/bin/env node
// Refuses `current_date` in supabase/tests/*.sql (retro 11 Nov 2026).
// The database runs in UTC, so `current_date` is the UTC date: from 00:00 to 07:00 Bangkok
// it is still Bangkok yesterday, and a test whose "tomorrow" is `current_date + 1` failed on
// main at night. Series days, report days and every user-facing date are Bangkok days.
import fs from 'node:fs';
import path from 'node:path';

export const BANGKOK_DATE = "(now() at time zone 'Asia/Bangkok')::date";

const CURRENT_DATE = /\bcurrent_date\b/i;

/** 1-based line numbers of every line that uses `current_date`. */
export function currentDateLines(text) {
  return text.split(/\r?\n/).flatMap((line, i) => (CURRENT_DATE.test(line) ? [i + 1] : []));
}

/** Every `current_date` in the .sql files of `dir`, as { file, line, text }. */
export function findCurrentDate(dir) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .flatMap((name) => {
      const lines = fs.readFileSync(path.join(dir, name), 'utf8').split(/\r?\n/);
      return currentDateLines(lines.join('\n')).map((line) => ({
        file: name,
        line,
        text: (lines[line - 1] ?? '').trim(),
      }));
    });
}

export const TESTS_DIR = path.resolve(import.meta.dirname, '..', 'supabase', 'tests');

function main() {
  const found = findCurrentDate(TESTS_DIR);
  if (found.length === 0) {
    console.info('supabase/tests: no current_date');
    return;
  }
  for (const f of found) console.error(`supabase/tests/${f.file}:${f.line}: current_date  ${f.text}`);
  console.error(
    `\n${found.length} use(s) of current_date, which is the UTC date (Bangkok yesterday from 00:00 to 07:00).` +
      `\nUse the Bangkok date instead: ${BANGKOK_DATE}`,
  );
  process.exit(1);
}

if (process.argv[1] && path.basename(process.argv[1]) === 'check-sql-tests.mjs') main();
