import 'server-only';
import type { DbClient } from '@dxt/db';
import { bangkokMonth, aggregateUptime } from '@dxt/engine';
import { formatDuration, formatPercent } from '@dxt/shared';
import type { ReportFigures } from './figures';
import { monthLabel, reportMonths } from './month';
import { liveFigures, loadDrafts, loadReportClients } from './queries';
import { incidentNote, rowWords, type ReportRowWords } from './words';

/**
 * The Reports page's data (board Reports, spec §14.12, D-072, D-073 item 13): a closed month reads
 * each client's stored draft — the same figures its PDF printed — and the running month is worked out
 * now. RLS as the signed-in staff member.
 */

export type ReportStatus = 'draft' | 'not_drafted' | 'running' | 'unreadable';

export interface ReportRow extends ReportRowWords {
  clientId: string;
  tier1: boolean;
  status: ReportStatus;
}

export interface ReportsPage {
  month: string;
  label: string;
  running: boolean;
  closed: string;
  runningMonth: string;
  rows: ReportRow[];
  tiles: { label: string; value: string; caption: string }[];
}

export async function loadReportsPage(db: DbClient, month: string, now: Date): Promise<ReportsPage> {
  const months = reportMonths(now);
  const running = month === months.running;
  const { to } = bangkokMonth(month, now);
  const clients = await loadReportClients(db, to);
  const drafts = running ? new Map() : await loadDrafts(db, month);
  const missing = clients.filter((c) => running || !drafts.get(c.id)?.figures);
  const live = await liveFigures(db, month, now, missing);

  const figures: ReportFigures[] = [];
  const rows: ReportRow[] = [];
  for (const c of clients) {
    const draft = drafts.get(c.id);
    const f = draft?.figures ?? live.get(c.id);
    if (!f) continue;
    figures.push(f);
    rows.push({
      ...rowWords(f),
      clientId: c.id,
      tier1: c.sites.some((s) => s.tier === 1),
      status: running ? 'running' : draft ? (draft.figures ? 'draft' : 'unreadable') : 'not_drafted',
    });
  }
  return {
    month,
    label: running ? `${monthLabel(month)} (running)` : monthLabel(month),
    running,
    closed: months.closed,
    runningMonth: months.running,
    rows,
    tiles: tilesOf(figures, month, running),
  };
}

/** Uptime (every client site, time-weighted), downtime (outages only) and incidents across clients. */
function tilesOf(all: readonly ReportFigures[], month: string, running: boolean): ReportsPage['tiles'] {
  const sites = all.flatMap((f) => f.sites).filter((s) => s.uptime !== null);
  // time-weighted over every client site, as a client's own figure (spec §5, D-073 item 9)
  const uptime = sites.length
    ? aggregateUptime(
        sites.map((s) => ({
          windowMinutes: s.windowMinutes,
          maintenanceMinutes: s.maintenanceMinutes,
          downMinutes: (1 - s.uptime!) * (s.windowMinutes - s.maintenanceMinutes),
        })),
      )
    : null;
  const sum = (k: 'outages' | 'degraded' | 'open' | 'downMinutes') => all.reduce((n, f) => n + f[k], 0);
  const note = incidentNote({ outages: sum('outages'), degraded: sum('degraded'), open: sum('open') });
  return [
    {
      label: `Uptime · ${running ? `${monthLabel(month, { short: true }).split(' ')[0]} so far` : monthLabel(month, { short: true })}`,
      value: uptime === null ? '—' : formatPercent(uptime),
      caption: `${sites.length} client site${sites.length === 1 ? '' : 's'} · maintenance excluded`,
    },
    {
      label: 'Downtime',
      value: formatDuration(sum('downMinutes')),
      caption: 'Outages only, across all clients',
    },
    {
      label: 'Incidents',
      value: String(sum('outages') + sum('degraded')),
      caption: note ? note.split(', ').join(' · ') : 'None',
    },
  ];
}
