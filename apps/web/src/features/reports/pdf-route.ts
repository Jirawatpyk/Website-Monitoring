import 'server-only';
import { z } from 'zod';
import type { DbClient } from '@dxt/db';
import { bangkokMonth } from '@dxt/engine';
import { getAccess } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { serviceDb } from '@/server/db';
import { REPORTS_BUCKET } from './drafts';
import { reportMonths, reportMonthSchema } from './month';
import { renderReportPdf } from './pdf/render';
import { liveFigures, loadDrafts, loadReportClients } from './queries';
import { pdfModel, reportId } from './words';

/**
 * `GET /api/reports/[clientId]/[month]` — a client's monthly PDF (board ReportPDF, S20, D-072,
 * D-073 item 13). Not in PUBLIC_PATHS: the proxy sends a signed-out request to /login, and this route
 * refuses anyone but active staff.
 *
 * - **Closed month:** the stored draft. Its `client_reports` row is read with the person's own
 *   session (RLS: staff read), and only that row's `storage_path` is downloaded with the service role
 *   (the bucket has no storage policies). No row yet → worked out now, as the running month is.
 * - **Running month:** worked out now and printed on demand ("Preview draft"), nothing stored. Each
 *   person may print a few a minute (`PREVIEW_LIMIT`); a print takes a Chromium launch.
 *
 * Nothing is written, so no audit row (apps/web/audit-coverage.json: exempt).
 */

const paramsSchema = z.object({ clientId: z.uuid(), month: reportMonthSchema });

export const PREVIEW_LIMIT = { count: 4, windowMs: 60_000 };
const recent = new Map<string, number[]>();

/**
 * Per instance only (no shared store): with Fluid compute one instance serves most requests, and the
 * worst case is a few more prints across instances — each is staff-only and bounded by maxDuration.
 */
export function takePreview(userId: string, now: number): boolean {
  const kept = (recent.get(userId) ?? []).filter((t) => now - t < PREVIEW_LIMIT.windowMs);
  if (kept.length >= PREVIEW_LIMIT.count) {
    recent.set(userId, kept);
    return false;
  }
  recent.set(userId, [...kept, now]);
  return true;
}

export interface PdfRouteDeps {
  access?: typeof getAccess;
  userDb?: () => Promise<DbClient>;
  service?: () => DbClient;
  render?: typeof renderReportPdf;
  clock?: () => Date;
}

const text = (body: string, status: number) =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });

function pdfResponse(bytes: Uint8Array, filename: string): Response {
  return new Response(bytes as BodyInit, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${filename.replace(/[^\w.-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    },
  });
}

export function reportPdfHandler(deps: PdfRouteDeps = {}) {
  const {
    access = getAccess,
    userDb = async () => (await createClient()) as unknown as DbClient,
    service = serviceDb,
    render = renderReportPdf,
    clock = () => new Date(),
  } = deps;
  return async function GET(
    _req: Request,
    ctx: { params: Promise<{ clientId: string; month: string }> },
  ): Promise<Response> {
    const who = await access();
    if (who.status !== 'active') return text('Sign in first.', 401);
    if (who.profile.role === 'client') return text('Reports are for DxT staff.', 403);
    const parsed = paramsSchema.safeParse(await ctx.params);
    if (!parsed.success) return text('No such report.', 404);
    const { clientId, month } = parsed.data;
    const now = clock();
    const { closed, running } = reportMonths(now);
    if (month !== closed && month !== running) return text('No such report.', 404);

    const db = await userDb();
    const [client] = await loadReportClients(db, bangkokMonth(month, now).to, clientId);
    if (!client) return text('No such report.', 404); // unknown, internal, or nothing watched

    if (month === closed) {
      const draft = (await loadDrafts(db, month, clientId)).get(clientId);
      if (draft?.figures) {
        const file = await service().storage.from(REPORTS_BUCKET).download(draft.storagePath);
        if (file.data) {
          return pdfResponse(
            new Uint8Array(await file.data.arrayBuffer()),
            `${reportId(draft.figures)} ${client.name}.pdf`,
          );
        }
        // the row without its file (an upload that failed): print it from the stored figures
        return printed(
          who.profile.id,
          pdfModel(draft.figures),
          `${reportId(draft.figures)} ${client.name}.pdf`,
        );
      }
    }
    const f = (await liveFigures(db, month, now, [client])).get(client.id);
    if (!f) return text('No such report.', 404);
    return printed(
      who.profile.id,
      pdfModel(f),
      `${reportId(f)} ${client.name}${f.running ? ' (preview)' : ''}.pdf`,
    );

    async function printed(userId: string, model: ReturnType<typeof pdfModel>, filename: string) {
      if (!takePreview(userId, now.getTime())) {
        return text('Too many previews in a minute — try again shortly.', 429);
      }
      return pdfResponse(await render(model), filename);
    }
  };
}
