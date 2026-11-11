import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentDateLines, findCurrentDate, TESTS_DIR } from './check-sql-tests.mjs';

test('current_date is found on its line, in any case', () => {
  const sql = ['select 1;', "values (current_date + 2, 'x');", 'select CURRENT_DATE;'].join('\n');
  assert.deepEqual(currentDateLines(sql), [2, 3]);
});

test('the Bangkok date and look-alike names are not flagged', () => {
  const sql = [
    "select (now() at time zone 'Asia/Bangkok')::date + 1;",
    'select my_current_date_col, current_dates from t;',
  ].join('\r\n');
  assert.deepEqual(currentDateLines(sql), []);
});

// Runs in CI through `pnpm test:coverage`, which doesn't run `pnpm check`.
test('supabase/tests uses no current_date (the UTC date; use the Bangkok one)', () => {
  assert.deepEqual(findCurrentDate(TESTS_DIR), []);
});
