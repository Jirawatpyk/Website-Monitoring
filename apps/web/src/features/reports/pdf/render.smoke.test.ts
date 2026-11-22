// @vitest-environment node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFigures, type FigureIncident } from '../figures';
import { pdfModel } from '../words';
import { pdfPrinter, renderReportPdf } from './render';

/**
 * S20 Done-when 2: prints a long, Thai-heavy sample to A4 with the real Chromium. Opt-in (it launches a
 * browser): `PDF_SMOKE=1 pnpm --filter @dxt/web exec vitest run src/features/reports/pdf`. Writes
 * `apps/web/test-results/report-smoke.pdf` for the PR.
 */
const run = process.env.PDF_SMOKE === '1' ? describe : describe.skip;

run('renderReportPdf (smoke)', () => {
  it('prints Thai with its tone marks, many incidents across pages, under 5 MB', async () => {
    const start = '2026-08-03T07:06:00Z';
    const incidents: FigureIncident[] = Array.from({ length: 24 }, (_, k) => {
      const at = new Date(Date.parse(start) + k * 26 * 3_600_000).toISOString();
      const end = new Date(Date.parse(at) + (5 + k) * 60_000).toISOString();
      return {
        siteId: k % 2 ? 'a' : 'b',
        number: 100 + k,
        severity: k % 3 ? 'down' : 'problem',
        trigger: k % 3 ? 'hard_fail' : 'slow',
        startedAt: at,
        resolvedAt: end,
        rootCauseCategory: 'hosting',
        rootCause:
          'ผู้ให้บริการโฮสติ้งมีปัญหาเครือข่าย ติ้ง ตั๋ว น้ำ — restored by the provider; we followed up for their incident report.',
        events: [
          { type: 'detected', at, payload: {} },
          { type: 'recovered', at: end, payload: {} },
        ],
      };
    });
    const f = buildFigures({
      monthKey: '2026-08',
      now: new Date('2026-09-01T00:00:00Z'),
      client: { name: 'บริษัท ตัวอย่าง จำกัด <script>', am: 'ผู้ดูแล' },
      sites: [
        { id: 'a', name: 'เว็บไซต์หลัก', tier: 1, monitoringStartedAt: new Date('2026-07-01T00:00:00Z') },
        { id: 'b', name: 'Booking site', tier: 2, monitoringStartedAt: new Date('2026-07-01T00:00:00Z') },
      ],
      incidents,
      maintenance: new Map([
        ['a', [{ start: new Date('2026-08-12T15:00:00Z'), end: new Date('2026-08-12T17:00:00Z') }]],
      ]),
      stopped: new Map(),
      response: [{ siteId: 'a', checks: 100, p50: 540, p95: 1200 }],
    });
    const t0 = Date.now();
    const pdf = await renderReportPdf(pdfModel(f));
    const ms = Date.now() - t0;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeLessThan(5 * 1024 * 1024);
    const out = path.join(process.cwd(), 'test-results');
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, 'report-smoke.pdf'), pdf);
    console.info(JSON.stringify({ bytes: pdf.length, ms }));

    // the drafts cron's way: several reports in one browser (the first run on production prints ~10)
    const printer = pdfPrinter();
    try {
      const t1 = Date.now();
      const many = [];
      for (let i = 0; i < 3; i++) many.push(await printer.render(pdfModel(f)));
      expect(many.every((b) => b.subarray(0, 5).toString() === '%PDF-')).toBe(true);
      console.info(JSON.stringify({ printedInOneBrowser: many.length, ms: Date.now() - t1 }));
    } finally {
      await printer.close();
    }
  }, 90_000);
});
