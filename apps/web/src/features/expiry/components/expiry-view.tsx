'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Badge,
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
  IconCalendar,
  IconCircleAlert,
  IconCircleCheck,
  IconClock,
  IconInfo,
  IconLoaderCircle,
  IconLock,
  IconCircleDotDashed,
} from '@jirawatpyk/aura-react/icons';
import { readWords, type DayTone, type ExpiryData, type ExpiryHalf, type ExpiryRowView } from '../model';
import { TOUCH_HIT } from '@/components/site-cells';
import { CheckNowButton } from './check-now';

const KPI_ICONS = [<IconLock key="l" />, <IconCalendar key="c" />, <IconClock key="k" />];

const TONE: Record<DayTone, string> = {
  alert: 'border border-alert-danger-border bg-alert-danger-bg font-semibold text-alert-danger-fg',
  soon: 'border border-alert-warning-border bg-alert-warning-bg font-semibold text-alert-warning-fg',
  plain: '',
  none: 'text-fg-secondary',
};

/** The date, or "Couldn't read · Timeout" with the last good date under it, greyed (spec-checker: no tooltip-only text). */
function DateCell({ half }: { half: ExpiryHalf }) {
  if (half.error) {
    return (
      <span className="flex flex-col items-start text-fg-secondary">
        <span>{`Couldn't read · ${readWords(half.error)}`}</span>
        {half.date && <span className="text-xs">{`last ${half.date}`}</span>}
      </span>
    );
  }
  return <span className={half.date ? '' : 'text-fg-secondary'}>{half.date ?? '—'}</span>;
}

function DaysCell({ half }: { half: ExpiryHalf }) {
  if (half.days === null) return <span className="text-fg-secondary">—</span>;
  // a failed read's old count is greyed, never red or amber: it is the last good date, not a reading now
  const words = half.days < 0 ? 'Expired' : String(half.days);
  const label =
    half.tone === 'alert'
      ? `${words}, under the alert line`
      : half.tone === 'soon'
        ? `${words}, due soon`
        : undefined;
  return (
    <span
      aria-label={label}
      className={`inline-block rounded-full px-2 leading-6 ${TONE[half.error ? 'none' : half.tone]}`}
    >
      {words}
    </span>
  );
}

/** Status never by colour alone: each badge has its icon and words (spec §11). */
function StatusBadge({ status }: { status: ExpiryRowView['status'] }) {
  if (status === 'soon')
    return (
      <Badge tone="warning" icon={<IconClock />}>
        Due soon
      </Badge>
    );
  if (status === 'failed')
    return (
      <Badge tone="neutral" variant="outline" icon={<IconCircleAlert />}>
        Couldn&apos;t read
      </Badge>
    );
  if (status === 'unchecked')
    return (
      <Badge tone="neutral" variant="outline" icon={<IconCircleDotDashed />}>
        Not checked yet
      </Badge>
    );
  return (
    <Badge tone="success" icon={<IconCircleCheck />}>
      OK
    </Badge>
  );
}

function Row({ r }: { r: ExpiryRowView }) {
  return (
    <Tr>
      {/* the flexible column: at least 176 px, a longer name truncates (the board's ellipsis) */}
      <Td label="Site" className="min-w-44 font-medium">
        <Link
          href={`/sites/${r.siteId}`}
          title={r.name}
          className={`max-w-full text-fg-primary hover:underline ${TOUCH_HIT}`}
        >
          {/* truncate inside, so the 44 px tap area isn't clipped (as the Sites list) */}
          <span className="block max-w-72 truncate">{r.name}</span>
        </Link>
      </Td>
      <Td label="SSL expires" className="whitespace-nowrap tabular-nums">
        <DateCell half={r.ssl} />
      </Td>
      <Td label="Days" className="whitespace-nowrap text-right tabular-nums">
        <DaysCell half={r.ssl} />
      </Td>
      <Td label="Certificate" className="whitespace-nowrap text-xs text-fg-secondary">
        {r.certificate ?? '—'}
      </Td>
      <Td label="Domain expires" className="whitespace-nowrap tabular-nums">
        <DateCell half={r.domain} />
      </Td>
      <Td label="Days" className="whitespace-nowrap text-right tabular-nums">
        <DaysCell half={r.domain} />
      </Td>
      <Td label="Status" className="whitespace-nowrap">
        <StatusBadge status={r.status} />
      </Td>
    </Tr>
  );
}

/** `/expiry` — SSL & domains (board Expiry, spec §14.12, §15.8; S13, D-066). Staff, read only + Check now. */
export function ExpiryView({ data, canCheck }: { data: ExpiryData; canCheck: boolean }) {
  const all = `All ${data.rows.length}`;
  const SOON = 'Within 60 days';
  // keyed on a boolean, not the "All N" label, which changes when a refresh brings a new site
  const [soonOnly, setSoonOnly] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const shown = soonOnly ? data.rows.filter((r) => r.soon) : data.rows;
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`;
  const meta = checking ? (
    <span className="inline-flex items-center gap-1.5">
      <IconLoaderCircle size="sm" aria-hidden className="motion-safe:animate-spin" />
      {`Checking ${n(data.certificates, 'certificate')} and ${n(data.domains, 'domain')} now · started ${checking} · results in about 1 min`}
    </span>
  ) : (
    data.meta
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titleHideBelow="lg"
        eyebrow="SITES"
        title="SSL & domains"
        meta={meta}
        actionsFullWidthBelow="md"
        actions={canCheck ? <CheckNowButton onChecking={setChecking} /> : undefined}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {data.kpis.map((k, i) => (
          <Stat
            key={k.label}
            label={k.label}
            value={k.value}
            unit={k.unit}
            caption={k.caption}
            icon={KPI_ICONS[i]}
          />
        ))}
      </div>

      <div className="flex gap-3 rounded-aura-lg border border-border-default bg-bg-surface px-aura-4 py-3 text-sm">
        <span className="flex pt-0.5 text-fg-secondary" aria-hidden>
          <IconInfo size="sm" />
        </span>
        <p className="m-0">
          <b>How it alerts:</b> SSL under 14 days or a domain under 30 days turns the site Problem and opens
          an incident for the owner. Domains and paid certificates under 60 days are listed here and in the
          weekly summary — no alert. Auto-renew certificates are only listed when under 30 days. An expired
          certificate is a hard fail, so the primary monitor catches it as Down.
        </p>
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="expiry-all">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 id="expiry-all" className="m-0 text-2xl font-semibold">
              All sites
            </h2>
            <span className="text-sm text-fg-secondary">Soonest expiry first</span>
          </div>
          <SegmentedControl
            label="Show"
            options={[all, SOON]}
            value={soonOnly ? SOON : all}
            onChange={(v) => setSoonOnly(v === SOON)}
            size="sm"
            touchHeight
          />
        </div>
        {/* D-066 item 7: until MExpiry, the table scrolls inside its own box on a phone; the page doesn't */}
        <div data-scroll-x className="overflow-x-auto">
          <div className="min-w-4xl">
            <Table caption="Certificate and domain expiry" captionHidden align="middle">
              <THead>
                <Tr>
                  <Th>Site</Th>
                  <Th className="whitespace-nowrap">SSL expires</Th>
                  <Th className="text-right">Days</Th>
                  <Th>Certificate</Th>
                  <Th className="whitespace-nowrap">Domain expires</Th>
                  <Th className="text-right">Days</Th>
                  <Th>Status</Th>
                </Tr>
              </THead>
              <TBody>
                {shown.length === 0 ? (
                  <Tr>
                    <Td colSpan={7} className="text-fg-secondary">
                      {data.rows.length === 0 ? 'No live sites yet.' : 'Nothing due within 60 days.'}
                    </Td>
                  </Tr>
                ) : (
                  shown.map((r) => <Row key={r.siteId} r={r} />)
                )}
              </TBody>
            </Table>
          </div>
        </div>
      </section>
    </div>
  );
}
