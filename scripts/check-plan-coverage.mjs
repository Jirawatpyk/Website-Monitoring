#!/usr/bin/env node
// Checks docs/implementation-plan.md against the sources it must cover:
// every FR in docs/prd.md, every canvas board, every PRD §11 table and every go-live test item maps to
// exactly one existing slice, and every slice has a "Done when" section. Exit 1 on any gap.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

const plan = read('docs/implementation-plan.md');
const prd = read('docs/prd.md');
const errors = [];

// Slices declared in the main table: | S01 | …
const slices = new Set([...plan.matchAll(/^\| (S\d{2}|G\d) \|/gm)].map((m) => m[1]));

// Appendix rows: | <key> | … | <Sxx> |  (slice is the last cell)
function appendixSection(title) {
  const start = plan.indexOf(`### ${title}`);
  if (start < 0) {
    errors.push(`Appendix section "${title}" is missing`);
    return new Map();
  }
  const end = plan.indexOf('\n### ', start + 4);
  const body = plan.slice(start, end < 0 ? undefined : end);
  const rows = new Map();
  for (const line of body.split('\n')) {
    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length < 2 || /^-+$/.test(cells[0]) || !/^S\d{2}$/.test(cells.at(-1))) continue;
    const key = cells[0];
    if (rows.has(key)) errors.push(`${title}: "${key}" is mapped more than once`);
    rows.set(key, cells.at(-1));
  }
  return rows;
}

function expectCovered(title, expected, rows) {
  for (const key of expected) {
    const slice = rows.get(key);
    if (!slice) errors.push(`${title}: "${key}" has no slice`);
    else if (!slices.has(slice)) errors.push(`${title}: "${key}" maps to unknown slice ${slice}`);
  }
  for (const key of rows.keys())
    if (!expected.includes(key)) errors.push(`${title}: "${key}" is not in the source`);
}

const frs = [...new Set([...prd.matchAll(/^\| (FR-\d{2}[ab]?) \|/gm)].map((m) => m[1]))];
const boards = readdirSync(path.join(root, 'docs/design/canvas'))
  .filter((f) => f.endsWith('.dc.html'))
  .map((f) => f.replace('.dc.html', ''));
const dataModel = prd.slice(prd.indexOf('## 11. Data Model'), prd.indexOf('## 12.'));
const tables = [
  ...new Set(
    [...dataModel.matchAll(/^\| `([a-z_]+)`(?: \/ `([a-z_]+)`)? \|/gm)].flatMap((m) =>
      m.slice(1).filter(Boolean),
    ),
  ),
  'profiles',
];
const testPlan = prd.slice(prd.indexOf('**Test plan'), prd.indexOf('## 13.'));
const testCount = [...testPlan.matchAll(/^- \[[ x]\] /gm)].length;
const tests = Array.from({ length: testCount }, (_, i) => `T${String(i + 1).padStart(2, '0')}`);

expectCovered('Functional requirements', frs, appendixSection('Functional requirements'));
expectCovered('Boards', boards, appendixSection('Boards'));
expectCovered('Tables (PRD §11)', tables, appendixSection('Tables (PRD §11)'));
expectCovered('Go-live test plan (PRD §12)', tests, appendixSection('Go-live test plan (PRD §12)'));

// Every slice (not gates) has a detail section with "Done when".
for (const id of [...slices].filter((s) => s.startsWith('S'))) {
  const start = plan.indexOf(`### ${id} ·`);
  if (start < 0) {
    errors.push(`${id}: no "### ${id} · …" section`);
    continue;
  }
  const next = plan.indexOf('\n### ', start + 4);
  if (!plan.slice(start, next < 0 ? undefined : next).includes('**Done when:**')) {
    errors.push(`${id}: no "Done when" list`);
  }
}

const summary = `${frs.length} FRs · ${boards.length} boards · ${tables.length} tables · ${tests.length} test items · ${slices.size} slices/gates`;
if (errors.length) {
  console.error(`Plan coverage: ${errors.length} problem(s)\n- ${errors.join('\n- ')}\n(${summary})`);
  process.exit(1);
}
console.info(`Plan coverage OK — ${summary}`);
