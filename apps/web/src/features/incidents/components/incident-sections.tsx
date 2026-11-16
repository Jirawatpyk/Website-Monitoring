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
  IconMail,
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
  formatShortWhen,
} from '@dxt/shared';
import { GLYPH_LEGEND, GLYPHS, type LocationGlyph } from '@/components/site-cells';
import type { CheckCell, IncidentDetail } from '../detail-queries';
import type { TimelineItem } from '../model';
import { FlapRun } from './flap-run';
import { PAGE_CHANGE_HOLD_FETCHES } from '@dxt/engine';

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
  baseline: { icon: <IconCircleCheck />, tone: 'text-fg-positive' },
  client_due: { icon: <IconMail />, tone: 'text-fg-warning' },
  client_marked: { icon: <IconCircleCheck />, tone: 'text-fg-positive' },
  client_not_needed: { icon: <IconCircleCheck />, tone: 'text-fg-secondary' },
};

/** One row of facts from lg, however many the case has (5–7; the board's `factCols`). */
const COLS: Record<number, string> = { 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6', 7: 'lg:grid-cols-7' };

export function FactsStrip({ detail: d, now }: { detail: IncidentDetail; now: Date }) {
  const confirmedAt = new Date(d.detectedAt);
  const page = d.pageChange;
  const facts = [
    {
      label: page ? 'FIRST SEEN' : 'STARTED',
      value: [startedOn(d, now), formatTimeWithSeconds(new Date(d.startedAt))].filter(Boolean).join(' '),
      caption: page
        ? 'First fetch that differed'
        : d.trigger === 'manual'
          ? 'Opened by hand'
          : 'First failed check',
    },
    {
      label: d.severity === 'down' ? 'CONFIRMED DOWN' : page ? 'CONFIRMED PROBLEM' : 'DETECTED',
      value: d.trigger === 'manual' ? '—' : formatTimeWithSeconds(confirmedAt),
      caption: page
        ? page.newScript.length
          ? 'New script domain — raised on the first fetch'
          : `Held ${PAGE_CHANGE_HOLD_FETCHES} fetches (1 h)`
        : d.trigger === 'manual'
          ? 'No probe check · engine down'
          : `${d.severity === 'down' && d.trigger === 'hard_fail' ? 'Immediate recheck · ' : ''}MTTD ${formatDurationSeconds(d.detectSeconds)}`,
    },
    // §37.3: the home page back with something still failing — two facts, the DOWN that is over (its
    // minutes, D-033) and the PROBLEM that is open; one mixed cell read as still down.
    ...(d.stillFailing
      ? [
          {
            label: 'DOWN FOR',
            value: formatDuration(d.durationMinutes),
            caption: `${shortSpan(d.stillFailing.downFrom, d.stillFailing.downTo, now)} · counts in uptime`,
          },
          {
            label: 'PROBLEM SINCE',
            value: problemSince(d, now),
            caption: `${formatDuration(Math.max(1, Math.round((now.getTime() - Date.parse(d.stillFailing.since)) / 60_000)))} · ${d.stillFailing.path ? `${d.stillFailing.path} still failing` : d.stillFailing.what}`,
            warning: true,
          },
        ]
      : [
          {
            label: 'DURATION',
            value: formatDuration(d.durationMinutes),
            caption: d.recoveredAt
              ? d.severity === 'problem'
                ? `Problem ${formatTime(new Date(d.startedAt))} → recovered ${formatTime(new Date(d.recoveredAt))}`
                : `Recovered ${formatTime(new Date(d.recoveredAt))}`
              : d.severity === 'problem' || d.nowSeverity === 'problem'
                ? `Problem since ${problemSince(d, now)}`
                : 'Still down',
            danger: !d.recoveredAt && d.nowSeverity === 'down',
          },
        ]),
    // The ladder in one cell (Incident board ESCALATION): left out with no plan.
    ...(d.escalation
      ? [{ label: 'ESCALATION', value: d.escalation.fact.value, caption: d.escalation.fact.caption }]
      : []),
    // Outside response hours a Tier 1 incident pages the person on call, not the owner (§28.6).
    d.paged
      ? {
          label: 'PAGED · ON CALL',
          value: `${d.paged.name}${d.paged.you ? ' (you)' : ''}`,
          caption: [d.owner ? `Owner ${d.owner}, not paged` : null, d.am ? `AM ${d.am}` : null]
            .filter(Boolean)
            .join(' · '),
        }
      : {
          label: 'OWNER',
          value: d.owner ?? 'No owner set',
          caption:
            [d.backup ? `Backup ${d.backup}` : null, d.am ? `AM ${d.am}` : null]
              .filter(Boolean)
              .join(' · ') || ' ',
        },
    {
      label: 'ACKNOWLEDGED',
      value: d.acked
        ? `${d.acked.by}${d.view.ack.kind === 'acked' && d.view.ack.byViewer ? ' (you)' : ''}`
        : '—',
      caption: d.acked
        ? d.ackInHoursMin
          ? `${formatTime(new Date(d.acked.at))} · ${formatDuration(d.ackInHoursMin)} into response hours`
          : `${formatTimeWithSeconds(new Date(d.acked.at))} · ${formatDuration(
              Math.max(1, Math.round((Date.parse(d.acked.at) - confirmedAt.getTime()) / 60_000)),
            )} after ${d.severity === 'down' ? 'confirmed down' : 'detected'}`
        : d.recoveredAt || d.resolvedAt
          ? 'Not acknowledged'
          : `${formatDuration(Math.max(1, Math.round((now.getTime() - confirmedAt.getTime()) / 60_000)))} since ${
              d.trigger === 'manual' ? 'opened' : d.severity === 'down' ? 'confirmed down' : 'detected'
            }`,
    },
  ] as { label: string; value: string; caption: string; danger?: boolean; warning?: boolean }[];
  return (
    <dl className={`aura-card m-0 grid grid-cols-2 gap-4 p-aura-5 ${COLS[facts.length] ?? 'lg:grid-cols-5'}`}>
      {facts.map((f) => (
        <div
          key={f.label}
          className={`flex min-w-0 flex-col gap-0.5 ${f.warning ? 'rounded-aura-md bg-alert-warning-bg p-aura-2' : ''}`}
        >
          <dt className={`font-mono text-xs ${f.warning ? 'text-alert-warning-fg' : 'text-fg-tertiary'}`}>
            {f.label}
          </dt>
          <dd
            className={`m-0 text-lg font-semibold tabular-nums ${f.danger ? 'text-fg-danger' : f.warning ? 'text-alert-warning-fg' : ''}`}
          >
            {f.value}
          </dd>
          <dd className={`m-0 text-xs ${f.warning ? 'text-alert-warning-fg' : 'text-fg-secondary'}`}>
            {f.caption}
          </dd>
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

function GlyphLegend({ withProblem = false }: { withProblem?: boolean } = {}) {
  const keys: readonly LocationGlyph[] = withProblem
    ? [...GLYPH_LEGEND.slice(0, 2), 'problem', ...GLYPH_LEGEND.slice(2)]
    : GLYPH_LEGEND;
  return (
    <ul className="m-0 mt-3 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-fg-secondary">
      {keys.map((k) => (
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
  const key = d.stillFailing?.keyPage;
  if (key && key.rows.some((r) => r.latest)) {
    // §37.4 phone: the key page's round, the home page in the footer.
    const rows = key.rows.filter((r) => r.latest);
    const fails = rows.filter((r) => r.latest!.glyph !== 'pass').length;
    const home = key.rows.filter((r) => r.home?.glyph === 'pass').length;
    return (
      <Card
        title={`${key.path} · Latest round${keyLatestAt(key.rows, 'latest') ? ` ${keyLatestAt(key.rows, 'latest')}` : ''}`}
        headingLevel={2}
        description={
          fails ? `${fails}/${rows.length} fail → PROBLEM` : `${rows.length}/${rows.length} pass → OK`
        }
      >
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {rows.map((l) => (
            <li key={l.location} className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">{l.location}</span>
              <CheckText cell={l.latest} location={l.location} />
            </li>
          ))}
        </ul>
        <p className="m-0 mt-2 flex items-center gap-1.5 text-sm text-fg-primary">
          <span className="flex text-fg-positive [&_svg]:size-4" aria-hidden>
            <IconCircleCheck />
          </span>
          {`Home page OK · ${home}/${key.rows.length} pass since ${formatTime(new Date(d.stillFailing!.since))}${homeCode(key.rows) ? ` · ${homeCode(key.rows)}` : ''}`}
        </p>
        <GlyphLegend />
      </Card>
    );
  }
  const latest = d.locations.filter((l) => l.latest);
  if (!latest.length && d.trigger === 'manual')
    return (
      <p className="m-0 rounded-aura-md border border-dashed border-border-default p-aura-3 text-sm text-fg-secondary">
        Opened by hand while the status engine was down — no probe results for this check
      </p>
    );
  if (!latest.length) return null;
  const at = latestRoundAt(d);
  // A location silent for 3 min before the round shown has no result in it (a probe down, a sweep
  // fault — staging /verify S12b): "No data", not its old pass, and it doesn't count in the verdict.
  const fresh = (l: (typeof latest)[number]) =>
    !at || !l.latest?.at || Date.parse(at) - Date.parse(l.latest.at) < STALE_LOCATION_MS;
  const counted = latest.filter(fresh);
  return (
    <Card
      title={at ? `Latest round · ${formatTimeWithSeconds(new Date(at))}` : 'Latest round'}
      headingLevel={2}
      description={roundVerdict(counted.map((l) => l.latest!.glyph))}
    >
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {latest.map((l) => (
          <li key={l.location} className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium">{l.location}</span>
            {fresh(l) ? (
              <CheckText cell={l.latest} location={l.location} />
            ) : (
              <CheckText cell={{ text: 'No data', glyph: 'none' }} location={l.location} />
            )}
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
  const key = d.stillFailing?.keyPage;
  if (key && key.rows.length) {
    // §37.4: the home page passes, the key page fails — both, so the page never reads "OK" under a PROBLEM.
    const firstAt = d.stillFailing!.since;
    return (
      <>
        <Table aria-label="Evidence by location">
          <THead>
            <Tr>
              <Th>Location</Th>
              <Th>{`Home page · latest${keyLatestAt(key.rows, 'home') ? ` ${keyLatestAt(key.rows, 'home')}` : ''}`}</Th>
              <Th>{`${key.path} · first fail ${formatTimeWithSeconds(new Date(firstAt))}`}</Th>
              <Th>{`${key.path} · latest${keyLatestAt(key.rows, 'latest') ? ` ${keyLatestAt(key.rows, 'latest')}` : ''}`}</Th>
            </Tr>
          </THead>
          <TBody>
            {key.rows.map((l) => (
              <Tr key={l.location}>
                <Td className="font-medium">{LOCATION_LABELS[l.location]}</Td>
                {[l.home, l.first, l.latest].map((c, n) => (
                  <Td key={n}>
                    <CheckText cell={c} location={l.location} />
                  </Td>
                ))}
              </Tr>
            ))}
          </TBody>
        </Table>
        <StillFailingNote detail={d} />
        <GlyphLegend withProblem />
      </>
    );
  }
  if (d.locations.length === 0) {
    // Opened by hand while the engine was down (S12b, §30.5): no probe ran for it.
    return (
      <p className="m-0 text-sm text-fg-secondary">
        {d.trigger === 'manual'
          ? 'Opened by hand while the status engine was down — no probe results for this check. Probe evidence starts with the first round after the engine is back.'
          : 'No checks found around the start.'}
      </p>
    );
  }
  return (
    <>
      <Table aria-label="Evidence by location">
        <THead>
          <Tr>
            <Th>Location</Th>
            <Th>{`First check · ${formatTimeWithSeconds(new Date(d.startedAt))}`}</Th>
            <Th>
              {/* spec §29.7: the Check log's ↻ recheck mark */}
              <span className="inline-flex items-center gap-1">
                <IconRotateCcw size={12} aria-hidden />
                {`Recheck · ${formatTimeWithSeconds(new Date(d.detectedAt))}`}
              </span>
            </Th>
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
      {/* §37 M6: the home page's own chain still failing — say why it is still open */}
      {d.stillFailing && <StillFailingNote detail={d} />}
      <GlyphLegend />
    </>
  );
}

/** The newest check time in a key-page column ("10:06:40"), for its header. */
function keyLatestAt(
  rows: readonly { home: CheckCell | null; latest: CheckCell | null }[],
  col: 'home' | 'latest',
): string | null {
  const t = rows
    .flatMap((r) => (r[col]?.at ? [r[col]!.at!] : []))
    .sort()
    .at(-1);
  return t ? formatTimeWithSeconds(new Date(t)) : null;
}

/** "HTTP 200" when the home page's latest checks answered that code (the phone card's footer). */
function homeCode(rows: readonly { home: CheckCell | null }[]): string | null {
  const code = rows.map((r) => /^(\d{3}) /.exec(r.home?.text ?? '')?.[1]).find(Boolean);
  return code ? `HTTP ${code}` : null;
}

/** §37.4: why the incident is still open though the home page passes. */
function StillFailingNote({ detail: d }: { detail: IncidentDetail }) {
  const s = d.stillFailing;
  if (!s) return null;
  const since = formatTime(new Date(s.since));
  let lead: string;
  let text: string;
  if (s.keyPage) {
    const n = s.keyPage.rows.length;
    const home = s.keyPage.rows.filter((r) => r.home?.glyph === 'pass').length;
    const failing = s.keyPage.rows.filter((r) => r.latest && r.latest.glyph !== 'pass');
    const words = failing[0]?.latest?.text.replace(/ · [\d.]+ (s|ms)$/, '');
    lead = `Home page OK · ${s.keyPage.path} still failing.`;
    text = ` The home page has passed at ${home} of ${n} since ${since}, so the DOWN ended there; ${s.keyPage.path} ${words ? `answers ${words}` : 'fails'} at ${failing.length} of ${n}, so the incident stays open as a PROBLEM (${s.trigger}). It clears after 2 OK rounds of ${s.keyPage.path}.`;
  } else {
    // The home page's own certificate chain (D-029): it answers, so the DOWN ended; the chain still fails.
    lead = `Home page answers · ${s.what}.`;
    text = ` The home page has answered since ${since}, so the DOWN ended there; its certificate chain still fails, so the incident stays open as a PROBLEM (${s.trigger}). It clears after 2 OK rounds.`;
  }
  return (
    <p className="m-0 mt-3 flex items-start gap-2.5 rounded-aura-md border border-alert-warning-border bg-alert-warning-bg p-aura-3 text-sm">
      <span className="flex pt-0.5 text-alert-warning-fg [&_svg]:size-4" aria-hidden>
        <IconTriangleAlert />
      </span>
      <span>
        <b className="font-semibold">{lead}</b>
        {text}
      </span>
    </p>
  );
}

/** Where each location checks from, as the Incident board labels its rows. */
const LOCATION_LABELS: Record<string, string> = {
  BKK: 'BKK · Thai VPS',
  SIN: 'SIN · sin1',
  TYO: 'TYO · hnd1',
};

/** The newest of the locations' latest checks. */
/** A location whose newest check is this much older than the round shown is out of it. */
const STALE_LOCATION_MS = 3 * 60_000;

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
  d: Pick<IncidentDetail, 'locations' | 'severity' | 'trigger'> &
    Partial<Pick<IncidentDetail, 'stillFailing'>>,
): string | null {
  const key = d.stillFailing?.keyPage;
  if (key && key.rows.length) {
    // §37.4: "Home page passes at 3 of 3 · /booking fails at 3 of 3 → PROBLEM (Key page)"
    const n = key.rows.length;
    const home = key.rows.filter((r) => r.home?.glyph === 'pass').length;
    const fails = key.rows.filter((r) => r.latest && r.latest.glyph !== 'pass').length;
    return `Home page passes at ${home} of ${n} · ${key.path} fails at ${fails} of ${n} → PROBLEM (${d.stillFailing!.trigger})`;
  }
  if (d.stillFailing) {
    // The home page's own chain (no key page): it answers, the chain fails — not the DOWN's verdict.
    const latest = d.locations.filter((l) => l.latest);
    const chain = latest.filter((l) => l.latest!.glyph === 'chain').length;
    return `Home page answers at ${latest.length} of ${latest.length} · TLS chain error at ${chain} of ${latest.length} → PROBLEM (${d.stillFailing.trigger})`;
  }
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
  /** A DOWN back with a PROBLEM still open (§19.7): when that PROBLEM began; else null. */
  problemSince: string | null;
  /**
   * §37: "home page back 09:35 · down from Thu 23:41 (Hard fail)" for the header, and the phone's two
   * summary lines; null unless the home page came back with something still failing.
   */
  stillFailing: { meta: string; phone: [string, string] } | null;
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

/** "Thu 23:41" (§37.3), dated when weeks back ("Wed 21 Oct 21:15", INC-0003): `formatShortWhen`. */
export function shortWhen(iso: string, now: Date): string {
  return formatShortWhen(new Date(iso), now);
}

/**
 * "Thu 23:41 → Fri 09:35" (§37.3): the end carries its day whenever the start does, so a span over
 * midnight never reads as one evening.
 */
export function shortSpan(fromIso: string, toIso: string, now: Date): string {
  const to = new Date(toIso);
  const a = shortWhen(fromIso, now);
  const b = shortWhen(toIso, now);
  const withDay =
    a.includes(' ') && !b.includes(' ') ? `${formatDay(to, { weekday: true }).split(' ')[0]} ${b}` : b;
  return `${a} → ${withDay}`;
}

/** A DOWN back with a PROBLEM still open (§19.7): when that PROBLEM began — "08:08", "Fri 13 Nov 09:15". */
export function problemSince(d: Pick<IncidentDetail, 'nowSince'>, now: Date): string {
  return [startedOn({ startedAt: d.nowSince }, now), formatTime(new Date(d.nowSince))]
    .filter(Boolean)
    .join(' ');
}

export function incidentSections(d: IncidentDetail, now: Date): IncidentSections {
  return {
    startedOn: startedOn(d, now),
    problemSince:
      !d.recoveredAt && d.nowSeverity === 'problem' && d.severity === 'down' ? problemSince(d, now) : null,
    stillFailing: d.stillFailing
      ? {
          meta: `home page back ${problemSince(d, now)} · down from ${shortWhen(d.stillFailing.downFrom, now)} (${d.stillFailing.downTrigger})`,
          phone: [
            `Problem since ${problemSince(d, now)} · ${formatDuration(Math.max(1, Math.round((now.getTime() - Date.parse(d.stillFailing.since)) / 60_000)))}`,
            `Home page back ${formatTime(new Date(d.stillFailing.since))} · was down ${formatDuration(d.durationMinutes)} (${shortSpan(d.stillFailing.downFrom, d.stillFailing.downTo, now)})`,
          ],
        }
      : null,
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
