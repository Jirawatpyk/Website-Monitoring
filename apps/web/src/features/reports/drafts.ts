import 'server-only';
import type { DbClient } from '@dxt/db';
import { bangkokMonth } from '@dxt/engine';
import type { ReportFigures } from './figures';
import { previousMonth, monthKeyOf } from './month';
import { liveFigures, loadDrafts, loadReportClients } from './queries';
import { pdfModel } from './words';

/**
 * The monthly drafts (S20, D-072 item 2, D-073 items 11, 13): every 10 minutes the cron works out the last
 * complete month for every client and stores the draft — figures and PDF — when there is none yet
 * (the first run on the 1st) or when its figures changed since (a root cause added, a false alarm
 * marked). So the page and the PDF of a closed month always read the stored draft. Service role.
 */

export const REPORTS_BUCKET = 'client-reports';

/** 06:00 on the 1st, Bangkok: six hours after the month ends. */
export const DRAFTS_FROM_MS = 6 * 3_600_000;

export const draftPath = (clientId: string, monthKey: string) => `${clientId}/${monthKey}.pdf`;

/** JSON with every object's keys sorted, so the stored copy (jsonb reorders keys) compares equal. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v ?? null);
}

/** The figures without the moment they were worked out: what decides whether a draft changed. */
const comparable = (f: ReportFigures) => stableJson({ ...f, generatedAt: null });

export type DraftsResult = {
  ok: boolean;
  month: string;
  clients: number;
  made: number;
  refreshed: number;
  unchanged: number;
  failed: number;
};

export async function runReportDrafts(
  db: DbClient,
  now: Date,
  render: (model: ReturnType<typeof pdfModel>) => Promise<Buffer>,
): Promise<DraftsResult> {
  const month = previousMonth(monthKeyOf(now));
  const { to } = bangkokMonth(month, now);
  // the drafts are made from 06:00 on the 1st (board Reports), once the last day's rollups are in
  if (now.getTime() - to.getTime() < DRAFTS_FROM_MS) {
    return { ok: true, month, clients: 0, made: 0, refreshed: 0, unchanged: 0, failed: 0 };
  }
  const clients = await loadReportClients(db, to);
  const [figures, drafts] = await Promise.all([liveFigures(db, month, now, clients), loadDrafts(db, month)]);
  const out: DraftsResult = {
    ok: true,
    month,
    clients: clients.length,
    made: 0,
    refreshed: 0,
    unchanged: 0,
    failed: 0,
  };
  for (const c of clients) {
    const f = figures.get(c.id);
    if (!f) continue;
    const stored = drafts.get(c.id);
    if (stored?.figures && comparable(stored.figures) === comparable(f)) {
      out.unchanged++;
      continue;
    }
    try {
      const pdf = await render(pdfModel(f));
      const path = draftPath(c.id, month);
      const up = await db.storage
        .from(REPORTS_BUCKET)
        .upload(path, pdf, { contentType: 'application/pdf', upsert: true });
      if (up.error) throw new Error(`upload: ${up.error.message}`);
      const row = await db.from('client_reports').upsert(
        {
          client_id: c.id,
          month: `${month}-01`,
          figures: f,
          storage_path: path,
          generated_at: f.generatedAt,
        },
        { onConflict: 'client_id,month' },
      );
      if (row.error) throw new Error(`client_reports: ${row.error.message}`);
      if (stored) out.refreshed++;
      else out.made++;
    } catch (err) {
      // one client's failure never stops the others; the next run (10 min) tries again
      out.failed++;
      out.ok = false;
      console.error(
        JSON.stringify({
          job: 'report-drafts',
          client: c.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
  return out;
}
