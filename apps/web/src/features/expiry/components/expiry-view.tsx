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
  Tooltip,
  Tr,
} from '@jirawatpyk/aura-react';
import {
  IconCalendar,
  IconCircleAlert,
  IconCircleCheck,
  IconClock,
  IconInfo,
  IconLock,
  IconMinus,
} from '@jirawatpyk/aura-react/icons';
import type { DayTone, ExpiryData, ExpiryHalf, ExpiryRowView } from '../model';
import { TOUCH_HIT } from '@/components/site-cells';
import { CheckNowButton } from './check-now';

const KPI_ICONS = [<IconLock key="l" />, <IconCalendar key="c" />, <IconClock key="k" />];

const TONE: Record<DayTone, string> = {
  alert: 'border border-alert-danger-border bg-alert-danger-bg font-semibold text-alert-danger-fg',
  soon: 'border border-alert-warning-border bg-alert-warning-bg font-semibold text-alert-warning-fg',
  plain: '',
  none: 'text-fg-secondary',
};

/** The date, or "Couldn't read" with the reason; a failed read keeps its last good date, greyed. */
function DateCell({ half }: { half: ExpiryHalf }) {
  if (half.error) {
    return (
      <Tooltip content={half.error} side="bottom">
        <button type="button" className={`flex flex-col items-start text-left ${TOUCH_HIT}`}>
          <span className="text-alert-warning-fg">Couldn&apos;t read</span>
          {half.date && <span className="text-xs text-fg-tertiary">{`last ${half.date}`}</span>}
        </button>
      </Tooltip>
    );
  }
  return <span className={half.date ? '' : 'text-fg-secondary'}>{half.date ?? '—'}</span>;
}

function DaysCell({ half }: { half: ExpiryHalf }) {
  if (half.days === null) return <span className="text-fg-secondary">—</span>;
  // a failed read's old count comes greyed from the model (tone none), never red (D-066 item 3)
  return <span className={`inline-block rounded-full px-2 leading-6 ${TONE[half.tone]}`}>{half.days}</span>;
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
      <Badge tone="neutral" icon={<IconCircleAlert />}>
        Couldn&apos;t read
      </Badge>
    );
  if (status === 'unchecked')
    return (
      <Badge tone="neutral" icon={<IconMinus />}>
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
      <Td label="Site" className="font-medium">
        <Link href={`/sites/${r.siteId}`} className="text-fg-primary hover:underline">
          {r.name}
        </Link>
      </Td>
      <Td label="SSL expires" className="tabular-nums">
        <DateCell half={r.ssl} />
      </Td>
      <Td label="Days" className="text-right tabular-nums">
        <DaysCell half={r.ssl} />
      </Td>
      <Td label="Certificate" className="text-xs text-fg-secondary">
        {r.certificate ?? '—'}
      </Td>
      <Td label="Domain expires" className="tabular-nums">
        <DateCell half={r.domain} />
      </Td>
      <Td label="Days" className="text-right tabular-nums">
        <DaysCell half={r.domain} />
      </Td>
      <Td label="Status">
        <StatusBadge status={r.status} />
      </Td>
    </Tr>
  );
}

/** `/expiry` — SSL & domains (board Expiry, spec §14.12, §15.8; S13, D-066). Staff, read only + Check now. */
export function ExpiryView({ data, canCheck }: { data: ExpiryData; canCheck: boolean }) {
  const all = `All ${data.rows.length}`;
  const views = [all, 'Within 60 days'];
  const [view, setView] = useState(all);
  const [checking, setChecking] = useState<string | null>(null);
  const shown = view === all ? data.rows : data.rows.filter((r) => r.soon);
  const meta = checking
    ? `Checking ${data.certificates} certificates and ${data.domains} domains now · started ${checking} · results in about 1 min`
    : data.meta;

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
            options={views}
            value={view}
            onChange={setView}
            size="sm"
            touchHeight
          />
        </div>
        {/* D-066 item 7: until MExpiry, the table scrolls inside its own box on a phone; the page doesn't */}
        <div data-scroll-x className="overflow-x-auto">
          <div className="min-w-3xl">
            <Table caption="Certificate and domain expiry" captionHidden align="middle">
              <THead>
                <Tr>
                  <Th>Site</Th>
                  <Th>SSL expires</Th>
                  <Th className="text-right">Days</Th>
                  <Th>Certificate</Th>
                  <Th>Domain expires</Th>
                  <Th className="text-right">Days</Th>
                  <Th>Status</Th>
                </Tr>
              </THead>
              <TBody>
                {shown.length === 0 ? (
                  <Tr>
                    <Td colSpan={7} className="text-fg-secondary">
                      {data.rows.length === 0 ? 'No sites are monitored yet.' : 'Nothing due within 60 days.'}
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
