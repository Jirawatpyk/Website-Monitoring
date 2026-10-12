import { Card, Table, TBody, Td, Th, THead, Tr } from '@jirawatpyk/aura-react';
import {
  IconActivity,
  IconArrowUpRight,
  IconBan,
  IconBell,
  IconCheck,
  IconCircleAlert,
  IconCircleCheck,
  IconEye,
  IconImage,
  IconPencil,
  IconRotateCcw,
  IconTriangleAlert,
} from '@jirawatpyk/aura-react/icons';
import {
  formatDay,
  formatDuration,
  formatDurationSeconds,
  formatTime,
  formatTimeWithSeconds,
  isSameBangkokDay,
} from '@dxt/shared';
import { GLYPH_LEGEND, GLYPHS } from '@/components/site-cells';
import type { CheckCell, IncidentDetail } from '../detail-queries';
import type { TimelineItem } from '../model';
import { FlapRun } from './flap-run';

/**
 * The incident page's display-only parts (Incident / MIncident boards): no state, no handlers, so the
 * page draws them on the server and hands them to the client view as slots — the client bundle keeps
 * only buttons, dialogs and the ack / resolve state (S07 spec-check M9).
 */

const KIND_ICON: Record<TimelineItem['kind'], { icon: React.ReactNode; tone: string }> = {
  failed: { icon: <IconCircleAlert />, tone: 'text-fg-danger' },
  down: { icon: <IconBan />, tone: 'text-fg-danger' },
  problem: { icon: <IconTriangleAlert />, tone: 'text-fg-warning' },
  alert: { icon: <IconBell />, tone: 'text-fg-secondary' },
  ack: { icon: <IconCheck />, tone: 'text-fg-primary' },
  evidence: { icon: <IconImage />, tone: 'text-fg-secondary' },
  recovered: { icon: <IconEye />, tone: 'text-fg-positive' },
  ok: { icon: <IconCircleCheck />, tone: 'text-fg-positive' },
  note: { icon: <IconPencil />, tone: 'text-fg-secondary' },
  root_cause: { icon: <IconPencil />, tone: 'text-fg-warning' },
  resolved: { icon: <IconCircleCheck />, tone: 'text-fg-positive' },
  escalated: { icon: <IconArrowUpRight />, tone: 'text-fg-warning' },
  undone: { icon: <IconRotateCcw />, tone: 'text-fg-secondary' },
  flapping: { icon: <IconActivity />, tone: 'text-fg-warning' },
};

export function FactsStrip({ detail: d, now }: { detail: IncidentDetail; now: Date }) {
  const confirmedAt = new Date(d.detectedAt);
  const facts = [
    {
      label: 'STARTED',
      value: [startedOn(d, now), formatTimeWithSeconds(new Date(d.startedAt))].filter(Boolean).join(' '),
      caption: 'First failed check',
    },
    {
      label: d.severity === 'down' ? 'CONFIRMED DOWN' : 'DETECTED',
      value: formatTimeWithSeconds(confirmedAt),
      caption: `${d.severity === 'down' && d.trigger === 'hard_fail' ? 'Immediate recheck · ' : ''}MTTD ${formatDurationSeconds(d.detectSeconds)}`,
    },
    {
      label: 'DURATION',
      value: formatDuration(d.durationMinutes),
      caption: d.recoveredAt ? `Recovered ${formatTime(new Date(d.recoveredAt))}` : 'Still down',
      danger: !d.recoveredAt,
    },
    {
      label: 'OWNER',
      value: d.owner ?? 'No owner set',
      caption:
        [d.backup ? `Backup ${d.backup}` : null, d.am ? `AM ${d.am}` : null].filter(Boolean).join(' · ') ||
        ' ',
    },
    {
      label: 'ACKNOWLEDGED',
      value: d.acked
        ? `${d.acked.by}${d.view.ack.kind === 'acked' && d.view.ack.byViewer ? ' (you)' : ''}`
        : '—',
      caption: d.acked
        ? `${formatTimeWithSeconds(new Date(d.acked.at))} · ${formatDuration(
            Math.max(1, Math.round((Date.parse(d.acked.at) - confirmedAt.getTime()) / 60_000)),
          )} after ${d.severity === 'down' ? 'confirmed down' : 'detected'}`
        : d.recoveredAt || d.resolvedAt
          ? 'Not acknowledged'
          : `${formatDuration(Math.max(1, Math.round((now.getTime() - confirmedAt.getTime()) / 60_000)))} since ${
              d.severity === 'down' ? 'confirmed down' : 'detected'
            }`,
    },
  ];
  return (
    <dl className="aura-card m-0 grid grid-cols-2 gap-4 p-aura-5 lg:grid-cols-5">
      {facts.map((f) => (
        <div key={f.label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="font-mono text-xs text-fg-tertiary">{f.label}</dt>
          <dd className={`m-0 text-lg font-semibold tabular-nums ${f.danger ? 'text-fg-danger' : ''}`}>
            {f.value}
          </dd>
          <dd className="m-0 text-xs text-fg-secondary">{f.caption}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A check in words beside its §11 glyph (colour never alone), as Sites and Site detail draw them. */
function CheckText({ cell, location }: { cell: CheckCell | null; location: string }) {
  if (!cell) return <span className="text-fg-tertiary">—</span>;
  const g = GLYPHS[cell.glyph];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`flex [&_svg]:size-4 ${g.tone}`} role="img" aria-label={`${location}: ${g.label}`}>
        {g.icon}
      </span>
      <span>{cell.text}</span>
    </span>
  );
}

function GlyphLegend() {
  return (
    <ul className="m-0 mt-3 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-fg-secondary">
      {GLYPH_LEGEND.map((k) => (
        <li key={k} className="flex items-center gap-1">
          <span className={`flex [&_svg]:size-3.5 ${GLYPHS[k].tone}`} aria-hidden>
            {GLYPHS[k].icon}
          </span>
          {GLYPHS[k].label}
        </li>
      ))}
    </ul>
  );
}

export function LatestRoundCard({ detail: d }: { detail: IncidentDetail }) {
  const latest = d.locations.filter((l) => l.latest);
  if (!latest.length) return null;
  const at = latestRoundAt(d);
  return (
    <Card
      title={at ? `Latest round · ${formatTimeWithSeconds(new Date(at))}` : 'Latest round'}
      headingLevel={2}
      description={roundVerdict(latest.map((l) => l.latest!.glyph))}
    >
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {latest.map((l) => (
          <li key={l.location} className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium">{l.location}</span>
            <CheckText cell={l.latest} location={l.location} />
          </li>
        ))}
      </ul>
      <GlyphLegend />
    </Card>
  );
}

/**
 * A timeline's lines: oldest first on desktop, newest first on a phone (D-033). A flapping run is
 * one line whose own lines open under it ("Show n").
 */
export function TimelineLines({ items, newestFirst }: { items: TimelineItem[]; newestFirst: boolean }) {
  const ordered = newestFirst ? [...items].reverse() : items;
  return (
    <ol className="m-0 flex list-none flex-col p-0">
      {ordered.map((t, n) => (
        <li
          key={`${t.at}-${n}`}
          className="flex flex-wrap gap-x-3 gap-y-1 border-b border-border-subtle py-2.5 last:border-b-0"
        >
          <span className="w-16 shrink-0 pt-px font-mono text-xs text-fg-secondary">{t.time}</span>
          <span className={`flex shrink-0 pt-0.5 [&_svg]:size-4 ${KIND_ICON[t.kind].tone}`} aria-hidden>
            {KIND_ICON[t.kind].icon}
          </span>
          <span className="flex min-w-0 flex-1 flex-col leading-snug">
            <span className="text-sm font-medium">{t.title}</span>
            {t.detail && <span className="text-sm break-words text-fg-secondary">{t.detail}</span>}
          </span>
          {t.run && (
            <FlapRun count={t.run.length}>
              <TimelineLines items={t.run} newestFirst={newestFirst} />
            </FlapRun>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Evidence by location: first check, recheck and latest per location, with the glyph legend. */
export function EvidenceTable({ detail: d }: { detail: IncidentDetail }) {
  if (d.locations.length === 0) {
    return <p className="m-0 text-sm text-fg-secondary">No checks found around the start.</p>;
  }
  return (
    <>
      <Table aria-label="Evidence by location">
        <THead>
          <Tr>
            <Th>Location</Th>
            <Th>{`First check · ${formatTimeWithSeconds(new Date(d.startedAt))}`}</Th>
            <Th>{`Recheck · ${formatTimeWithSeconds(new Date(d.detectedAt))}`}</Th>
            <Th>
              {latestRoundAt(d) ? `Latest · ${formatTimeWithSeconds(new Date(latestRoundAt(d)!))}` : 'Latest'}
            </Th>
          </Tr>
        </THead>
        <TBody>
          {d.locations.map((l) => (
            <Tr key={l.location}>
              <Td className="font-medium">{LOCATION_LABELS[l.location]}</Td>
              {[l.first, l.recheck, l.latest].map((c, n) => (
                <Td key={n}>
                  <CheckText cell={c} location={l.location} />
                </Td>
              ))}
            </Tr>
          ))}
        </TBody>
      </Table>
      <GlyphLegend />
    </>
  );
}

/** Where each location checks from, as the Incident board labels its rows. */
const LOCATION_LABELS: Record<string, string> = {
  BKK: 'BKK · Thai VPS',
  SIN: 'SIN · sin1',
  TYO: 'TYO · hnd1',
};

/** The newest of the locations' latest checks. */
function latestRoundAt(d: Pick<IncidentDetail, 'locations'>): string | null {
  const times = d.locations.flatMap((l) => (l.latest?.at ? [l.latest.at] : [])).sort();
  return times.at(-1) ?? null;
}

/** "3/3 pass → OK", "3/3 hard fail → DOWN", else how many fail (MIncident Latest round). */
export function roundVerdict(glyphs: readonly string[]): string {
  const n = glyphs.length;
  const pass = glyphs.filter((g) => g === 'pass').length;
  const hard = glyphs.filter((g) => g === 'fail').length;
  if (pass === n) return `${n}/${n} pass → OK`;
  if (hard >= 2) return `${hard}/${n} hard fail → DOWN`;
  return `${n - pass}/${n} failing`;
}

/**
 * "3 of 3 locations hard fail on 2 checks in a row → DOWN (2 of 3 needed)" — how the DOWN was decided
 * (Incident board, Evidence card), from the first check and the recheck. Null when it wasn't a hard fail.
 */
export function evidenceSummary(
  d: Pick<IncidentDetail, 'locations' | 'severity' | 'trigger'>,
): string | null {
  if (d.severity !== 'down' || d.trigger !== 'hard_fail' || d.locations.length === 0) return null;
  const both = d.locations.filter(
    (l) => l.first?.glyph === 'fail' && (l.recheck ?? l.first)?.glyph === 'fail',
  ).length;
  return `${both} of ${d.locations.length} locations hard fail on 2 checks in a row → DOWN (2 of ${d.locations.length} needed)`;
}

/** "Thu 24 Sep" for an incident that started before today (Bangkok), else null: today's times stand alone. */
export function startedOn(d: Pick<IncidentDetail, 'startedAt'>, now: Date): string | null {
  const started = new Date(d.startedAt);
  return isSameBangkokDay(started, now) ? null : formatDay(started, { weekday: true });
}

export interface IncidentSections {
  /** The start day when it isn't today (`startedOn`), for the phone's summary line. */
  startedOn: string | null;
  /** How the DOWN was decided, under the Evidence card's title (`evidenceSummary`). */
  evidenceSummary: string | null;
  /** "18 min unacked" beside the badge while nobody acknowledged it (Incident header). */
  unackedFor: string | null;
  facts: React.ReactNode;
  evidenceTable: React.ReactNode;
  latestRound: React.ReactNode;
  timelineDesktop: React.ReactNode;
  timelinePhone: React.ReactNode;
}

/** The slots `IncidentDetailView` places, drawn once on the server. */
export function incidentSections(d: IncidentDetail, now: Date): IncidentSections {
  return {
    startedOn: startedOn(d, now),
    evidenceSummary: evidenceSummary(d),
    unackedFor:
      d.state === 'unacked' || d.state === 'escalated'
        ? `${formatDuration(Math.max(1, Math.floor((now.getTime() - Date.parse(d.detectedAt)) / 60_000)))} unacked`
        : null,
    facts: <FactsStrip detail={d} now={now} />,
    evidenceTable: <EvidenceTable detail={d} />,
    latestRound: <LatestRoundCard detail={d} />,
    timelineDesktop: <TimelineLines items={d.timeline} newestFirst={false} />,
    timelinePhone: <TimelineLines items={d.timeline} newestFirst />,
  };
}
