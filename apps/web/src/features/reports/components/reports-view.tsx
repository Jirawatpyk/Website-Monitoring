'use client';

import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
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
  IconClock,
  IconEye,
  IconMail,
  IconPencil,
} from '@jirawatpyk/aura-react/icons';
import { monthLabel } from '../month';
import type { ReportRow, ReportsPage } from '../page-data';

const STAT_ICONS = [<IconChartColumn key="u" />, <IconClock key="d" />, <IconBell key="i" />];

/** Why Send is off (D-072 item 3: sending to clients comes after go-live). */
const SEND_OFF = 'Sending reports to clients isn’t available yet — download the PDF and send it yourself';

const STATUS_WORDS: Record<ReportRow['status'], string> = {
  draft: 'Draft ready',
  not_drafted: 'Not drafted yet',
  running: 'Month running',
  unreadable: 'Draft from an older version',
};

function ReportCell({ r }: { r: ReportRow }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <StatusPill tone={r.status === 'draft' ? 'ready' : 'neutral'}>{STATUS_WORDS[r.status]}</StatusPill>
      {r.needsRootCause && (
        <Badge tone="warning" variant="outline" icon={<IconPencil />}>
          Needs root cause
        </Badge>
      )}
    </span>
  );
}

interface RowProps {
  r: ReportRow;
  month: string;
  label: string;
  preview: string;
}

/** Preview (the PDF, a new tab: the app's frame rules forbid showing it inside the page) and Send (off). */
function Actions({ r, month, label, preview }: RowProps) {
  return (
    <span className="flex flex-nowrap gap-1">
      <Button
        variant="ghost"
        size="sm"
        touchHeight
        icon={<IconEye />}
        href={`/api/reports/${r.clientId}/${month}`}
        target="_blank"
        rel="noopener"
        aria-label={`${preview} — ${r.client}, ${label} (PDF, opens in a new tab)`}
      >
        {preview}
      </Button>
      <Button variant="ghost" size="sm" touchHeight icon={<IconMail />} disabled title={SEND_OFF}>
        Send
      </Button>
    </span>
  );
}

/** Below xl a card per client: the table's columns don't fit 820 or a phone (D-018, no sideways scroll). */
function ReportCard(p: RowProps) {
  const { r } = p;
  return (
    <div className="flex flex-col gap-2 rounded-aura-lg border border-border-default bg-bg-surface px-aura-4 py-3 text-sm">
      <span className="flex flex-wrap items-center gap-2 font-semibold">
        {r.client}
        {r.tier1 && (
          <Badge tone="neutral" variant="outline">
            Tier 1
          </Badge>
        )}
      </span>
      <dl className="m-0 grid grid-cols-3 gap-2 tabular-nums">
        <div>
          <dt className="text-xs text-fg-secondary">Uptime</dt>
          <dd className="m-0 font-medium">{r.uptime}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-secondary">Downtime</dt>
          <dd className="m-0 font-medium">{r.down}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-secondary">Incidents</dt>
          <dd className="m-0 font-medium">{r.incidents}</dd>
        </div>
      </dl>
      <span className="text-fg-secondary">
        {[`${r.sites} site${r.sites === 1 ? '' : 's'}`, r.incidentNote, `AM ${r.am}`]
          .filter(Boolean)
          .join(' · ')}
      </span>
      <ReportCell r={r} />
      <Actions {...p} />
    </div>
  );
}

/**
 * `/reports` — Uptime reports (board Reports, spec §5, §12, §14.12; S20, D-072, D-073). Desktop and
 * tablet; the phone layout waits for its board (D-072 item 4); below xl each client is a card.
 */
export function ReportsView({ data, asOf }: { data: ReportsPage; asOf: string }) {
  const router = useRouter();
  const closed = monthLabel(data.closed, { short: true });
  const running = monthLabel(data.runningMonth, { short: true });
  const preview = data.running ? 'Preview draft' : 'Preview';

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
        actions={
          <SegmentedControl
            label="Month"
            size="sm"
            options={[closed, running]}
            value={data.running ? running : closed}
            onChange={(v) =>
              router.push(v === running ? `/reports?month=${data.runningMonth}` : '/reports', {
                scroll: false,
              })
            }
          />
        }
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4">
        {data.tiles.map((t, i) => (
          <Stat
            key={t.label}
            label={i === 2 ? 'Incidents clients see' : t.label}
            value={t.value}
            caption={t.caption}
            icon={STAT_ICONS[i]}
          />
        ))}
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="reports-table">
        <div className="flex flex-col gap-1">
          <h2 id="reports-table" className="m-0 flex flex-wrap items-baseline gap-x-3 text-lg font-semibold">
            {`Client reports · ${data.label}`}
            {data.running && (
              <span className="text-sm font-normal text-fg-secondary">
                Preview draft · generated on demand
              </span>
            )}
          </h2>
          <p className="m-0 text-sm text-fg-secondary">
            Tier 1 clients first. Incidents = what the client sees: Outage (a DOWN) and Degraded (a slow,
            key-page, regional or intermittent PROBLEM). SSL, domain, keyword and blocked-check PROBLEMs stay
            internal and aren’t counted. A report can’t go out while one of its incidents has no root cause.
          </p>
        </div>

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
                        <Actions r={r} month={data.month} label={data.label} preview={preview} />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
            <ul className="m-0 grid list-none grid-cols-1 gap-2.5 p-0 md:grid-cols-2 xl:hidden">
              {data.rows.map((r) => (
                <li key={r.clientId}>
                  <ReportCard r={r} month={data.month} label={data.label} preview={preview} />
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="m-0 text-xs text-fg-secondary">{SEND_OFF}.</p>
      </section>
    </div>
  );
}
