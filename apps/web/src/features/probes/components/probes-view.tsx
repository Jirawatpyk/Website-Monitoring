import { Alert, Badge, Card, StatusPill, Table, TBody, Td, Th, THead, Tr } from '@jirawatpyk/aura-react';
import { IconBell, IconCircleAlert, IconCircleCheck, IconInfo, IconMail } from '@jirawatpyk/aura-react/icons';
import { formatTime, formatTimeWithSeconds, formatWhen, isSameBangkokDay } from '@dxt/shared';
import { agoText, type BeatRow, type ProbeCard } from '../model';
import type { ProbesData } from '../queries';

const RESULT_WORDS = { loaded: 'passed', failed: 'failed', blocked: 'blocked in the browser too' } as const;

/** Results written per hour, the last 24 h: one bar per hour, a gap hour in the danger colour. */
function HourBars({ card }: { card: ProbeCard }) {
  const max = Math.max(1, ...card.hours);
  return (
    <figure className="m-0 flex flex-col gap-1">
      <svg
        viewBox="0 0 300 32"
        preserveAspectRatio="none"
        className="h-8 w-full"
        role="img"
        aria-label={`${card.code}: results written per hour over the last 24 h${card.gaps === '0' ? ', no gaps' : `, gaps ${card.gaps}`}`}
      >
        {card.hours.map((n, i) => {
          const h = n ? Math.max(2, (n / max) * 30) : 0;
          return (
            <rect
              key={i}
              x={i * 12.5 + 1}
              y={32 - h}
              width={10.5}
              height={h}
              className={card.gapHours[i] ? 'fill-fg-danger' : 'fill-fg-positive'}
            />
          );
        })}
      </svg>
      <figcaption className="text-xs text-fg-secondary">Results written per hour · last 24 h</figcaption>
    </figure>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs font-medium tracking-wide text-fg-secondary uppercase">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function ProbeCardView({ card, now }: { card: ProbeCard; now: Date }) {
  return (
    <Card
      title={`${card.code} · ${card.city}`}
      headingLevel={2}
      description={card.host}
      actions={
        card.healthy ? (
          <Badge tone="success" icon={<IconCircleCheck />}>
            Healthy
          </Badge>
        ) : (
          <Badge tone="danger" icon={<IconCircleAlert />}>
            No data
          </Badge>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Fact
            label="Last run"
            value={card.lastRunAt ? formatWhenShort(new Date(card.lastRunAt), now) : 'Not yet'}
          />
          <Fact label="Checks / min" value={card.rate ?? '—'} />
          <Fact label="Gaps · 24h" value={card.gaps} />
          <Fact label="Egress IP" value={card.egress} />
        </div>
        <HourBars card={card} />
      </div>
    </Card>
  );
}

/** Today's beats with seconds ("10:07:10"); an older one with its day. */
function formatWhenShort(d: Date, now: Date) {
  return isSameBangkokDay(d, now) ? formatTimeWithSeconds(d) : formatWhen(d, now);
}

function BeatStatus({ row }: { row: BeatRow }) {
  if (row.status === 'up') return <StatusPill tone="ready">Up</StatusPill>;
  if (row.status === 'down') return <StatusPill tone="blocked">Down</StatusPill>;
  return <StatusPill tone="neutral">No ping yet</StatusPill>;
}

function Who({ pages }: { pages: boolean }) {
  return pages ? (
    <span className="inline-flex items-center gap-1">
      <IconBell size={14} aria-hidden />
      Email Admins + Alerts Space @on-call
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-fg-secondary">
      <IconMail size={14} aria-hidden />
      Email Admins only · no page
    </span>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-border-subtle py-2 text-sm last:border-b-0">
      <span className="text-fg-secondary">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

/**
 * Probes & heartbeat (S12a, board Probes, spec §14.4, §15.3): the three probe locations, every
 * heartbeat with its grace and who it alerts, who hears about monitor faults, the pipeline and the
 * browser verifier — from our own timestamps (Healthchecks.io is the outside view). Read only; works
 * at 390 (§22.5).
 */
export function ProbesView({ data }: { data: ProbesData }) {
  const now = new Date(data.nowIso);
  const { pipeline, verifier } = data;
  return (
    <div className="flex flex-col gap-6">
      <Alert
        tone={data.summary.healthy ? 'success' : data.summary.empty ? 'info' : 'danger'}
        icon={
          data.summary.healthy ? <IconCircleCheck /> : data.summary.empty ? <IconInfo /> : <IconCircleAlert />
        }
        title={data.summary.title}
      >
        {data.gapLines.length
          ? `${data.gapLines.length === 1 ? 'One gap' : `${data.gapLines.length} gaps`} in the last 24 h: ${data.gapLines
              .slice(0, 3)
              .map((g) => g.text)
              .join(' · ')}.`
          : 'No probe location missed more than 3 min in the last 24 h.'}
      </Alert>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {data.probes.map((p) => (
          <ProbeCardView key={p.code} card={p} now={now} />
        ))}
      </div>

      <Card
        title="Heartbeats"
        headingLevel={2}
        description="Pinged to Healthchecks.io, outside our system · grace and who is alerted per check"
      >
        <Table caption="Heartbeats" captionHidden stackBelow="md" align="middle" bleed>
          <THead>
            <Tr>
              <Th>Check</Th>
              <Th>Runs on</Th>
              <Th>Expected · grace</Th>
              <Th>Missed → who is alerted</Th>
              <Th>Last ping</Th>
              <Th>Status</Th>
            </Tr>
          </THead>
          <TBody>
            {data.beats.map((b) => (
              <Tr key={b.name}>
                <Td label="Check" className="font-mono font-medium">
                  {b.name}
                </Td>
                <Td label="Runs on">{b.on}</Td>
                {/* one column for both: seven columns' 10ch minimums don't fit the card at 820 */}
                <Td label="Expected · grace">{`${b.every} · grace ${b.grace}`}</Td>
                <Td label="Missed → who is alerted">
                  <Who pages={b.pages} />
                </Td>
                <Td label="Last ping">{b.lastAt ? agoText(b.lastAt, now) : '—'}</Td>
                <Td label="Status">
                  <BeatStatus row={b} />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
        {data.gapLines.length > 0 && (
          <ul className="m-0 mt-aura-4 flex list-none flex-col gap-2 p-0 text-sm">
            {data.gapLines.map((g) => (
              <li key={g.at + g.text} className="flex flex-wrap gap-x-3">
                <span className="font-medium">{formatWhen(new Date(g.at), now)}</span>
                <span>{`${g.text} — the other two locations kept deciding status.`}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Who hears about monitor faults" headingLevel={2}>
          <div className="flex flex-col gap-3 text-sm">
            <p className="m-0">
              {`Engine heartbeat (status engine / Vercel Cron) missed > 3 min → email to the Admins + an Alerts Space post that @mentions the on-call person${data.onCallName ? ` (${data.onCallName} now)` : ''}, sent from the Thai VPS.`}
            </p>
            <p className="m-0">
              A single probe (BKK, SIN or TYO) missing &gt; 3 min → email to the Admins only, no page. The
              other two locations still decide status.
            </p>
            <p className="m-0 text-fg-secondary">
              {`${data.admins === 1 ? '1 active Admin gets' : `${data.admins} active Admins get`} these emails.`}
            </p>
          </div>
        </Card>
        <Card title="Pipeline" headingLevel={2}>
          <Line
            label="Status engine sweep"
            value={pipeline.sweepAt ? formatWhenShort(new Date(pipeline.sweepAt), now) : 'Not yet'}
          />
          <Line
            label="Notifier last run"
            value={pipeline.notifierAt ? formatWhenShort(new Date(pipeline.notifierAt), now) : 'Not yet'}
          />
          {pipeline.delivery ? (
            <>
              <Line label="Notifier queue" value={`${pipeline.delivery.waiting} waiting`} />
              <Line
                label="Delivery · 24 h"
                value={`${pipeline.delivery.sent24h} sent · ${pipeline.delivery.failed24h} failed`}
              />
            </>
          ) : (
            <p className="m-0 pt-2 text-sm text-fg-secondary">Delivery counts are for Admins.</p>
          )}
        </Card>
        <Card title="Browser verifier · BKK VPS" headingLevel={2}>
          <Line label="Last poll" value={verifier.seenAt ? agoText(verifier.seenAt, now) : 'Not yet'} />
          <Line label="Queue" value={`${verifier.queue} (alert at > 5)`} />
          <Line
            label="Last job"
            value={
              verifier.lastJob
                ? `${formatTime(new Date(verifier.lastJob.at))} · ${verifier.lastJob.site}${verifier.lastJob.result ? ` · ${RESULT_WORDS[verifier.lastJob.result]}` : ''}`
                : 'None yet'
            }
          />
        </Card>
      </div>
    </div>
  );
}
