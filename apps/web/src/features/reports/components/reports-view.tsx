'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  PageHeader,
  SegmentedControl,
  Stat,
  StatusPill,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@jirawatpyk/aura-react';
import {
  IconBell,
  IconChartColumn,
  IconChevronRight,
  IconClock,
  IconExternalLink,
  IconEye,
  IconInfo,
  IconMail,
  IconPencil,
} from '@jirawatpyk/aura-react/icons';
import { monthLabel } from '../month';
import { incidentsShort, REPORT_STATUS as STATUS, statusNote } from '../words';
import type { ReportRow, ReportsPage } from '../page-data';

const STAT_ICONS = [<IconChartColumn key="u" />, <IconClock key="d" />, <IconBell key="i" />];

/** Why Send is off (D-072 item 3; words settled on MReports, spec §42 item 8). */
const SEND_OFF = 'Sending from here comes later — open the PDF and email it to the client yourself.';

/** Why a Viewer's Preview / Open PDF is off (PRD §3: Download uptime reports — Admin, Responder, Stakeholder). */
const VIEW_ONLY = 'Viewers see the figures; opening the PDF is for Admins, Responders and Stakeholders.';

const RULE =
  'Tier 1 clients first. Incidents = what the client sees: Outage (a DOWN) and Degraded (a slow, key-page, regional or intermittent PROBLEM). SSL, domain, keyword and blocked-check PROBLEMs stay internal and aren’t counted. A report can’t go out while one of its incidents has no root cause.';

function ReportCell({ r }: { r: ReportRow }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <StatusPill tone={STATUS[r.status].tone}>{STATUS[r.status].words}</StatusPill>
      {r.needsRootCause && (
        <Badge tone="warning" variant="outline" icon={<IconPencil />}>
          Needs root cause
        </Badge>
      )}
    </span>
  );
}

const pdfHref = (r: ReportRow, month: string) => `/api/reports/${r.clientId}/${month}`;

/** The reason Send is off, said in words wherever Send is (never only in a tooltip, §42 item 6). */
function SendOff() {
  return (
    <p className="m-0 flex gap-1.5 text-xs text-fg-secondary">
      <span className="flex pt-0.5" aria-hidden>
        <IconInfo size="sm" />
      </span>
      {SEND_OFF}
    </p>
  );
}

/** "What counts": the full rule from xl; below it one line with More / Less (§42 item 3). */
function RuleNote() {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <p className="m-0 text-sm text-fg-secondary max-xl:hidden">{RULE}</p>
      <div className="rounded-aura-lg border border-border-default bg-bg-surface text-sm xl:hidden">
        <div className="flex items-center gap-1.5 py-1 pr-1.5 pl-3.5">
          <span className="flex text-fg-secondary" aria-hidden>
            <IconInfo size="sm" />
          </span>
          <span className="min-w-0 grow">
            <b>What counts</b> <span className="text-xs text-fg-secondary">· what the client sees</span>
          </span>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen((o) => !o)}
            className="min-h-11 min-w-11 shrink-0 rounded-aura-sm px-1 font-medium text-fg-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            {open ? 'Less' : 'More'}
          </button>
        </div>
        <p id={id} hidden={!open} className="m-0 px-3.5 pb-3 text-fg-secondary">
          {RULE}
        </p>
      </div>
    </>
  );
}

/**
 * `/reports` — Uptime reports (boards Reports, MReports, MReportsDark; spec §5, §12, §14.12, §42; S20,
 * D-072, D-073). From xl the table; below it one card per client (two per row from md), the whole card
 * opening a sheet with the rest and the actions.
 */
export function ReportsView({
  data,
  asOf,
  canOpen,
}: {
  data: ReportsPage;
  asOf: string;
  /** Opening the PDF: Admins, Responders, Stakeholders; a Viewer sees the figures only (PRD §3 "Download uptime reports"). */
  canOpen: boolean;
}) {
  const router = useRouter();
  const closed = monthLabel(data.closed, { short: true });
  const running = monthLabel(data.runningMonth, { short: true });
  const preview = data.running ? 'Preview draft' : 'Preview';
  const openWords = data.running ? 'Open preview draft' : 'Open PDF';
  const [sheet, setSheet] = useState<ReportRow | null>(null);
  // the last one opened stays in the sheet while it animates closed (no blank title), as MAuditLog
  const [last, setLast] = useState<ReportRow | null>(null);
  if (sheet && sheet !== last) setLast(sheet);
  const shown = sheet ?? last;
  const cards = useRef(new Map<string, HTMLButtonElement>());

  const monthSwitch = (fullWidth: boolean) => (
    <SegmentedControl
      label="Month"
      size="sm"
      fullWidth={fullWidth}
      touchHeight={fullWidth ? 'always' : true}
      options={[closed, running]}
      value={data.running ? running : closed}
      onChange={(v) =>
        router.push(v === running ? `/reports?month=${data.runningMonth}` : '/reports', { scroll: false })
      }
    />
  );

  const [focusCard, setFocusCard] = useState<string | null>(null);
  // back to the card it came from once the sheet is gone (after React rendered: apps/web CLAUDE.md → Testing)
  useEffect(() => {
    if (sheet || !focusCard) return;
    cards.current.get(focusCard)?.focus();
    setFocusCard(null);
  }, [sheet, focusCard]);
  const closeSheet = () => {
    setFocusCard(sheet?.clientId ?? null);
    setSheet(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titleHideBelow="lg"
        eyebrow="REPORTS"
        title="Uptime reports"
        meta={
          <>
            <span className="block">{`Figures as of ${asOf} (UTC+7)`}</span>
            <span className="block">
              Monthly PDF per client in DxT branding, drafted on the 1st at 06:00 and refreshed when its
              figures change.
            </span>
          </>
        }
        actions={<span className="max-md:hidden">{monthSwitch(false)}</span>}
      />
      {/* Phones: full width under the header (MReports, §42 item 1), as Sites' Add site button */}
      <div className="md:hidden">{monthSwitch(true)}</div>

      {/* 2 + 1 on a phone, the third full width; 3 across from md (MReports, §42 item 2) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
        {data.tiles.map((t, i) => (
          <Stat
            key={t.label}
            label={i === 2 ? 'Incidents clients see' : t.label}
            value={t.value}
            caption={t.caption}
            icon={STAT_ICONS[i]}
            className={i === 2 ? 'max-md:col-span-2' : undefined}
          />
        ))}
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="reports-table">
        <div className="flex flex-col gap-0.5">
          <h2 id="reports-table" className="m-0 text-lg font-semibold">
            {`Client reports · ${data.label}`}
          </h2>
          {data.running && (
            <span className="text-sm text-fg-secondary">Preview draft · generated on demand</span>
          )}
        </div>
        <RuleNote />

        {data.rows.length === 0 ? (
          <EmptyState
            bordered
            headingLevel={3}
            icon={<IconChartColumn />}
            title="No client sites were watched this month"
            description="A client gets a report once one of its sites is being monitored."
          />
        ) : (
          <>
            <div className="max-xl:hidden">
              <Table>
                <THead>
                  <Tr>
                    <Th>Client</Th>
                    <Th className="text-right">Sites</Th>
                    <Th className="text-right">Uptime</Th>
                    <Th className="text-right">Downtime</Th>
                    <Th>Incidents</Th>
                    <Th>AM</Th>
                    <Th>Report</Th>
                    <Th>
                      <span className="sr-only">Actions</span>
                    </Th>
                  </Tr>
                </THead>
                <TBody>
                  {data.rows.map((r) => (
                    <Tr key={r.clientId}>
                      <Td label="Client" className="font-medium">
                        <span className="flex flex-wrap items-center gap-2">
                          {r.client}
                          {r.tier1 && (
                            <Badge tone="neutral" variant="outline">
                              Tier 1
                            </Badge>
                          )}
                        </span>
                      </Td>
                      <Td label="Sites" className="text-right tabular-nums">
                        {r.sites}
                      </Td>
                      <Td label="Uptime" className="text-right tabular-nums">
                        {r.uptime}
                      </Td>
                      <Td label="Downtime" className="whitespace-nowrap text-right tabular-nums">
                        {r.down}
                      </Td>
                      <Td label="Incidents">
                        <span className="tabular-nums">{r.incidents}</span>
                        {r.incidentNote && (
                          <span className="text-fg-secondary">{` · ${r.incidentNote}`}</span>
                        )}
                      </Td>
                      <Td label="AM">{r.am}</Td>
                      <Td label="Report">
                        <ReportCell r={r} />
                      </Td>
                      <Td label="Actions">
                        <span className="flex flex-nowrap gap-1">
                          {canOpen ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              touchHeight
                              icon={<IconEye />}
                              href={pdfHref(r, data.month)}
                              target="_blank"
                              rel="noopener"
                              aria-label={`${preview} — ${r.client}, ${data.label} (PDF, opens in a new tab)`}
                            >
                              {preview}
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              touchHeight
                              icon={<IconEye />}
                              disabled
                              title={VIEW_ONLY}
                            >
                              {preview}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            touchHeight
                            icon={<IconMail />}
                            disabled
                            title={SEND_OFF}
                          >
                            Send
                          </Button>
                        </span>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>

            {/* below xl the reason sits once above the list (§42 item 6) */}
            <div className="xl:hidden">
              <SendOff />
            </div>
            <ul className="m-0 grid list-none grid-cols-1 gap-2.5 p-0 md:grid-cols-2 xl:hidden">
              {data.rows.map((r) => (
                <li key={r.clientId} className="flex">
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) cards.current.set(r.clientId, el);
                      else cards.current.delete(r.clientId);
                    }}
                    onClick={() => setSheet(r)}
                    aria-label={`${r.client}${r.tier1 ? ', Tier 1' : ''}, uptime ${r.uptime}, down ${r.down}, ${incidentsShort(r.incidents)}, report ${STATUS[r.status].words}${r.needsRootCause ? ', needs root cause' : ''}. Show details`}
                    className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-aura-lg border border-border-default bg-bg-surface py-3 pr-2.5 pl-3.5 text-left text-fg-primary hover:bg-bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                  >
                    <span className="flex min-w-0 grow flex-col gap-1.5">
                      <span className="flex flex-wrap items-center gap-2 font-semibold">
                        {r.client}
                        {r.tier1 && (
                          <Badge tone="neutral" variant="outline">
                            Tier 1
                          </Badge>
                        )}
                      </span>
                      <span className="text-sm tabular-nums">
                        <b className="font-semibold">{r.uptime}</b>
                        <span className="text-fg-secondary">{` · down ${r.down} · ${incidentsShort(r.incidents)}`}</span>
                      </span>
                      <ReportCell r={r} />
                    </span>
                    <span className="flex shrink-0 text-fg-tertiary" aria-hidden>
                      <IconChevronRight size="sm" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="flex flex-col gap-1 max-xl:hidden">
          {!canOpen && <p className="m-0 text-xs text-fg-secondary">{VIEW_ONLY}</p>}
          <SendOff />
        </div>
      </section>

      <Dialog
        open={sheet !== null}
        onClose={closeSheet}
        size="sm"
        title={shown?.client ?? ''}
        description={
          shown
            ? [monthLabel(data.month), shown.tier1 ? 'Tier 1' : null, `AM ${shown.am}`]
                .filter(Boolean)
                .join(' · ')
            : ''
        }
      >
        {shown && (
          <div className="flex flex-col gap-3">
            <ReportCell r={shown} />
            {statusNote(shown.status, data.month) && (
              <p className="m-0 text-sm text-fg-secondary">{statusNote(shown.status, data.month)}</p>
            )}
            <dl className="m-0 flex flex-col text-sm">
              {[
                ['Uptime', shown.uptime],
                ['Downtime', shown.down],
                [
                  'Incidents',
                  shown.incidentNote ? `${shown.incidents} · ${shown.incidentNote}` : shown.incidents,
                ],
                [shown.siteNames.length === 1 ? 'Site' : 'Sites', shown.siteNames.join(', ')],
                ['AM', shown.am],
              ].map(([k, v]) => (
                <div
                  key={k}
                  className="flex justify-between gap-3 border-t border-border-subtle py-2 first:border-t-0"
                >
                  <dt className="shrink-0 text-fg-secondary">{k}</dt>
                  <dd className="m-0 text-right font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            {canOpen ? (
              <Button
                variant="secondary"
                fullWidth
                icon={<IconExternalLink />}
                href={pdfHref(shown, data.month)}
                target="_blank"
                rel="noopener"
                aria-label={`${openWords} — ${shown.client}, ${data.label} (opens in a new tab)`}
              >
                {openWords}
              </Button>
            ) : (
              <>
                <Button variant="secondary" fullWidth icon={<IconExternalLink />} disabled>
                  {openWords}
                </Button>
                <p className="m-0 text-xs text-fg-secondary">{VIEW_ONLY}</p>
              </>
            )}
            <Button variant="secondary" fullWidth icon={<IconMail />} disabled>
              Send
            </Button>
            <SendOff />
          </div>
        )}
      </Dialog>
    </div>
  );
}
