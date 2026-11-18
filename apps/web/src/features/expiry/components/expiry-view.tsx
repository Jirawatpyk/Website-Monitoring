'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  SegmentedControl,
  Stat,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@jirawatpyk/aura-react';
import {
  IconBan,
  IconCalendar,
  IconCircleAlert,
  IconCircleCheck,
  IconCircleDotDashed,
  IconClock,
  IconInfo,
  IconLoaderCircle,
  IconLock,
} from '@jirawatpyk/aura-react/icons';
import {
  cardLabel,
  readWords,
  type DayTone,
  type ExpiryData,
  type ExpiryHalf,
  type ExpiryRowView,
} from '../model';
import { TOUCH_HIT } from '@/components/site-cells';
import { CheckNowButton } from './check-now';

const KPI_ICONS = [<IconLock key="l" />, <IconCalendar key="c" />, <IconClock key="k" />];

const TONE: Record<DayTone, string> = {
  alert: 'border border-alert-danger-border bg-alert-danger-bg font-semibold text-alert-danger-fg',
  soon: 'border border-alert-warning-border bg-alert-warning-bg font-semibold text-alert-warning-fg',
  plain: '',
  none: 'text-fg-secondary',
};

/** The board's "How it alerts" words; the response hours come from the organisation's settings. */
const alertsText = (hours: string) =>
  `SSL under 14 days or a domain under 30 days turns the site Problem and opens an incident for the owner. Domains and paid certificates under 60 days are listed here and in the weekly summary — no alert. Auto-renew certificates are only listed when under 30 days. An expired certificate is a hard fail, so the primary monitor catches it as Down. Alerts wait for response hours (${hours}) on every tier — nobody is paged at night for something days away.`;

/** The date; "Couldn't read · Timeout" with the last good date under it, greyed; "Not checked yet" (§39.4). */
function DateText({
  half,
  unchecked,
  last = true,
}: {
  half: ExpiryHalf;
  unchecked: boolean;
  /** The "last …" line under the reason; a card puts it on its own line after the pill instead. */
  last?: boolean;
}) {
  if (half.error) {
    return (
      <span className="flex flex-col items-start text-fg-secondary">
        <span>{`Couldn't read · ${readWords(half.error)}`}</span>
        {last && half.date && <span className="text-xs">{`last ${half.date}`}</span>}
      </span>
    );
  }
  if (unchecked) return <span className="text-fg-secondary">Not checked yet</span>;
  return <span className={half.date ? '' : 'text-fg-secondary'}>{half.date ?? '—'}</span>;
}

/**
 * The day pill: red under the alert line and when expired, amber when due soon; greyed on a failed
 * read. Its meaning is in words for a screen reader too, never in the colour alone (§11).
 */
function DaysPill({ half }: { half: ExpiryHalf }) {
  if (half.days === null) return <span className="text-fg-secondary">—</span>;
  const words = half.days < 0 ? 'Expired' : String(half.days);
  const tone = half.error ? 'none' : half.tone;
  const said = `${half.days >= 0 ? (half.days === 1 ? ' day' : ' days') : ''}${tone === 'alert' ? ', under the alert line' : tone === 'soon' ? ', due soon' : ''}`;
  return (
    <span className={`inline-block rounded-full px-2 leading-6 ${TONE[tone]}`}>
      {words}
      <span className="sr-only">{said}</span>
    </span>
  );
}

/** Status never by colour alone: each badge has its icon and words (spec §11, §39.4). */
function StatusBadge({ status }: { status: ExpiryRowView['status'] }) {
  switch (status) {
    case 'unchecked':
      return (
        <Badge tone="neutral" variant="outline" icon={<IconCircleDotDashed />}>
          Not checked yet
        </Badge>
      );
    case 'failed':
      return (
        <Badge tone="neutral" variant="outline" icon={<IconCircleAlert />}>
          Couldn&apos;t read
        </Badge>
      );
    case 'expired':
      return (
        <Badge tone="danger" icon={<IconBan />}>
          Expired
        </Badge>
      );
    case 'soon':
      return (
        <Badge tone="warning" icon={<IconClock />}>
          Due soon
        </Badge>
      );
    default:
      return (
        <Badge tone="success" icon={<IconCircleCheck />}>
          OK
        </Badge>
      );
  }
}

function Row({ r }: { r: ExpiryRowView }) {
  const unchecked = r.status === 'unchecked';
  return (
    <Tr>
      <Td label="Site" className="font-medium">
        <Link
          href={`/sites/${r.siteId}`}
          title={r.name}
          className={`max-w-full text-fg-primary hover:underline ${TOUCH_HIT}`}
        >
          {/* truncate inside, so the 44 px tap area isn't clipped (as the Sites list) */}
          <span className="block max-w-full truncate">{r.name}</span>
        </Link>
      </Td>
      <Td label="SSL expires" className="whitespace-nowrap tabular-nums">
        <DateText half={r.ssl} unchecked={unchecked} />
      </Td>
      <Td label="SSL days left" className="whitespace-nowrap text-right tabular-nums">
        <DaysPill half={r.ssl} />
      </Td>
      <Td label="Certificate" className="whitespace-nowrap text-xs text-fg-secondary">
        {r.certificate ?? '—'}
      </Td>
      <Td label="Domain expires" className="whitespace-nowrap tabular-nums">
        <DateText half={r.domain} unchecked={unchecked} />
      </Td>
      <Td label="Domain days left" className="whitespace-nowrap text-right tabular-nums">
        <DaysPill half={r.domain} />
      </Td>
      <Td label="Status" className="whitespace-nowrap">
        <StatusBadge status={r.status} />
      </Td>
    </Tr>
  );
}

/** MExpiry / Expiry820 (§39.6–7): one card per site, the whole card opens Site detail. */
function Card({ r }: { r: ExpiryRowView }) {
  const unchecked = r.status === 'unchecked';
  return (
    <Link
      href={`/sites/${r.siteId}`}
      aria-label={cardLabel(r)}
      className="flex min-h-11 w-full flex-col gap-1.5 rounded-aura-lg border border-border-default bg-bg-surface px-aura-4 py-3 text-sm text-fg-primary no-underline hover:bg-bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    >
      <span className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate font-semibold">{r.name}</span>
        <span className="shrink-0">
          <StatusBadge status={r.status} />
        </span>
      </span>
      {/* the labels share one 52 px column, so the dates line up (the board) */}
      <span className="flex items-start gap-x-2 tabular-nums">
        <span className="w-13 shrink-0 text-fg-secondary">SSL</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <DateText half={r.ssl} unchecked={unchecked} last={false} />
          <DaysPill half={r.ssl} />
          {r.certificate && <span className="text-xs text-fg-secondary">{r.certificate}</span>}
          {r.ssl.error && r.ssl.date && (
            <span className="basis-full text-xs text-fg-secondary">{`last ${r.ssl.date}`}</span>
          )}
        </span>
      </span>
      <span className="flex items-start gap-x-2 tabular-nums">
        <span className="w-13 shrink-0 text-fg-secondary">Domain</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <DateText half={r.domain} unchecked={unchecked} last={false} />
          <DaysPill half={r.domain} />
          {r.domain.error && r.domain.date && (
            <span className="basis-full text-xs text-fg-secondary">{`last ${r.domain.date}`}</span>
          )}
        </span>
      </span>
    </Link>
  );
}

/** How it alerts: the full box from xl; below it one line with More / Less (§39.6). */
function HowItAlerts({ hours }: { hours: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const text = alertsText(hours);
  return (
    <div className="rounded-aura-lg border border-border-default bg-bg-surface text-sm">
      <div className="flex gap-3 px-aura-4 py-3 max-xl:hidden">
        <span className="flex pt-0.5 text-fg-secondary" aria-hidden>
          <IconInfo size="sm" />
        </span>
        <p className="m-0">
          <b>How it alerts:</b> {text}
        </p>
      </div>
      <div className="flex flex-col gap-1 py-1.5 pr-1.5 pl-3.5 xl:hidden">
        <div className="flex items-center gap-1.5">
          <span className="flex text-fg-secondary" aria-hidden>
            <IconInfo size="sm" />
          </span>
          <span className="min-w-0 grow">
            <b>How it alerts</b>{' '}
            <span className="text-xs text-fg-secondary">· SSL &lt; 14 d, domain &lt; 30 d</span>
          </span>
          {/* the board's text link: 44 px square at least, no button frame so the line fits 390 */}
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
        <p id={id} hidden={!open} className="m-0 pr-2 pb-2 text-fg-secondary">
          {text}
        </p>
      </div>
    </div>
  );
}

/**
 * `/expiry` — SSL & domains (boards Expiry, Expiry820, MExpiry; spec §14.12, §15.8, §39; S13, D-066).
 * Below xl the table is cards (D-066 item 9: the board's fixed columns don't fit 1024–1279 either).
 */
export function ExpiryView({ data, canCheck }: { data: ExpiryData & { hours: string }; canCheck: boolean }) {
  const total = data.rows.length;
  const all = `All ${total}`;
  const SOON = 'Within 60 days';
  // keyed on a boolean, not the "All N" label, which changes when a refresh brings a new site
  const [soonOnly, setSoonOnly] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  // Within 60 days keeps what nobody can say is fine: not checked yet and couldn't read (§39.4)
  const shown = soonOnly ? data.rows.filter((r) => r.soon || r.attention) : data.rows;
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`;
  const meta = checking ? (
    <span className="inline-flex items-center gap-1.5">
      <IconLoaderCircle size="sm" aria-hidden className="motion-safe:animate-spin" />
      {`Checking ${n(data.certificates, 'certificate')} and ${n(data.domains, 'domain')} now · started ${checking} · results in about 1 min`}
    </span>
  ) : (
    data.meta
  );
  const empty =
    total === 0 ? (
      <EmptyState bordered headingLevel={2} icon={<IconCircleDotDashed />} title="No live sites yet" />
    ) : (
      <EmptyState
        bordered
        headingLevel={2}
        icon={<IconCircleCheck />}
        title="Nothing due within 60 days"
        description={`All ${total} certificates and domains are further out. Checked daily at 06:00.`}
        action={
          <Button variant="secondary" touchHeight onClick={() => setSoonOnly(false)}>
            {`Show all ${total}`}
          </Button>
        }
      />
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titleHideBelow="lg"
        eyebrow="SITES"
        title="SSL & domains"
        meta={meta}
        actionsFullWidthBelow="lg"
        actions={canCheck ? <CheckNowButton onChecking={setChecking} /> : undefined}
      />

      {/* 2 per row on a phone with the third full width; 3 across from md (MExpiry, Expiry820) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
        {data.kpis.map((k, i) => (
          <Stat
            key={k.label}
            label={k.label}
            value={k.value}
            unit={k.unit}
            caption={k.caption}
            icon={KPI_ICONS[i]}
            className={i === 2 ? 'max-md:col-span-2' : undefined}
          />
        ))}
      </div>

      <HowItAlerts hours={data.hours} />

      <section className="flex flex-col gap-3" aria-labelledby="expiry-all">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-baseline gap-3 max-xl:sr-only">
            <h2 id="expiry-all" className="m-0 text-2xl font-semibold">
              All sites
            </h2>
            <span className="text-sm text-fg-secondary">Soonest expiry first</span>
          </div>
          {/* full width below xl (MExpiry, Expiry820), at its own size beside the heading from xl */}
          {[true, false].map((wide) => (
            <div key={String(wide)} className={wide ? 'w-full xl:hidden' : 'max-xl:hidden'}>
              <SegmentedControl
                label="Show"
                options={[all, SOON]}
                value={soonOnly ? SOON : all}
                onChange={(v) => setSoonOnly(v === SOON)}
                size="sm"
                touchHeight={wide ? 'always' : true}
                fullWidth={wide}
              />
            </div>
          ))}
        </div>

        {/* below xl the table becomes cards, one per row on a phone, two from md (§39.6–7, D-066 item 9) */}
        <div className="flex flex-col gap-2 xl:hidden">
          {shown.length > 0 && (
            <span className="text-xs text-fg-secondary">
              {soonOnly
                ? `${n(shown.length, 'site')} due within 60 days or not read`
                : `${n(total, 'site')} · soonest expiry first`}
            </span>
          )}
          {shown.length === 0 ? (
            empty
          ) : (
            <ul className="m-0 grid list-none grid-cols-1 gap-2.5 p-0 md:grid-cols-2">
              {shown.map((r) => (
                <li key={r.siteId} className="flex">
                  <Card r={r} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="max-xl:hidden">
          {shown.length === 0 ? (
            empty
          ) : (
            <Table caption="Certificate and domain expiry" captionHidden align="middle">
              <THead>
                <Tr>
                  {/* Site takes the room the fixed columns leave (the board's flexible column) */}
                  <Th className="w-full">Site</Th>
                  <Th className="whitespace-nowrap">SSL expires</Th>
                  <Th className="text-right">
                    Days<span className="sr-only"> left on the certificate</span>
                  </Th>
                  <Th>Certificate</Th>
                  <Th className="whitespace-nowrap">Domain expires</Th>
                  <Th className="text-right">
                    Days<span className="sr-only"> left on the domain</span>
                  </Th>
                  <Th>Status</Th>
                </Tr>
              </THead>
              <TBody>
                {shown.map((r) => (
                  <Row key={r.siteId} r={r} />
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </section>
    </div>
  );
}
