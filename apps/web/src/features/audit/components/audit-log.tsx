'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  Avatar,
  Button,
  DataTable,
  PageHeader,
  SegmentedControl,
  Select,
  type DataTableColumn,
} from '@jirawatpyk/aura-react';
import {
  IconArrowRight,
  IconCalendar,
  IconDownload,
  IconLock,
  IconSearch,
  IconUser,
  IconX,
} from '@jirawatpyk/aura-react/icons';
import { formatCount } from '@dxt/shared';
import type { AuditEntry, AuditPage } from '../queries';
import {
  AUDIT_CATEGORIES,
  AUDIT_RANGES,
  DEFAULT_RANGE,
  PAGE_LIMIT,
  filtersQuery,
  isFiltered,
  spanLabel,
  type AuditCategory,
  type AuditFilters,
  type AuditRange,
} from '../model';

/** Rows per table page: up to PAGE_LIMIT entries load, the table shows them 50 at a time. */
const TABLE_PAGE = 50;

const entries = (n: number) => (n === 1 ? '1 entry' : `${formatCount(n)} entries`);
const rows = (n: number) => (n === 1 ? '1 row' : `${formatCount(n)} rows`);

/** The line under the filters: "34 entries · Fri 18 Sep → Fri 25 Sep 10:07 · filtered from 34". */
export function countLine(data: Pick<AuditPage, 'total' | 'unfiltered' | 'filters' | 'nowIso'>): string {
  const span = spanLabel(data.filters.range, new Date(data.nowIso));
  const head =
    data.total > PAGE_LIMIT
      ? `Newest ${formatCount(PAGE_LIMIT)} of ${entries(data.total)} · ${span} · Export has them all`
      : `${entries(data.total)} · ${span}`;
  return isFiltered(data.filters) ? `${head} · filtered from ${formatCount(data.unfiltered)}` : head;
}

/** Audit log (board AuditLog, spec §16.11, D-061). Filters live in the URL; the server filters. */
export function AuditLogView({ data }: { data: AuditPage }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [exported, setExported] = useState(false);
  const f = data.filters;
  const filtered = isFiltered(f);
  const query = filtersQuery(f);

  const go = (next: AuditFilters) => {
    setExported(false);
    const q = filtersQuery(next);
    startTransition(() => router.push(q ? `/audit?${q}` : '/audit', { scroll: false }));
  };

  const columns: DataTableColumn<AuditEntry>[] = [
    {
      key: 'at',
      label: 'Time',
      width: 120,
      render: (e) => (
        <time dateTime={e.at} className="font-mono text-xs whitespace-nowrap text-fg-secondary">
          {e.atLabel}
        </time>
      ),
    },
    {
      key: 'actor',
      label: 'Actor',
      width: 140,
      render: (e) => (
        <span className="flex min-w-0 items-center gap-2">
          <Avatar name={e.actor} size="sm" />
          <span className="truncate">{e.actor}</span>
        </span>
      ),
    },
    {
      key: 'action',
      label: 'Action',
      width: 220,
      render: (e) => (
        <span className="flex min-w-0 flex-col py-1.5 leading-snug">
          <span className="truncate font-medium">{e.words}</span>
          <span className="truncate font-mono text-xs text-fg-tertiary">{e.action}</span>
        </span>
      ),
    },
    {
      key: 'entity',
      label: 'Entity',
      width: 200,
      render: (e) => <span className="line-clamp-2 leading-snug">{e.entity}</span>,
    },
    {
      key: 'change',
      label: 'Before → After',
      grow: 1,
      minWidth: 240,
      render: (e) => (
        <span className="flex min-w-0 items-center gap-2 py-1.5 font-mono text-xs leading-snug">
          {/* Two lines each at most, the full value on hover and in the CSV. */}
          <span
            className={`line-clamp-2 max-w-2/5 min-w-0 shrink-0 break-words text-fg-secondary ${e.struck ? 'line-through' : ''}`}
            title={e.before}
          >
            {e.before}
          </span>
          <span className="flex shrink-0 text-fg-tertiary">
            <IconArrowRight size="sm" aria-hidden />
            <span className="sr-only">to</span>
          </span>
          <span className="line-clamp-2 min-w-0 flex-1 break-words" title={e.after}>
            {e.after}
          </span>
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titleHideBelow="lg"
        eyebrow="REPORTS"
        title="Audit log"
        meta="Who did what, when, with the value before and after. Nobody can edit or delete an entry, Admin included."
        actionsFullWidthBelow="md"
        actions={
          <>
            {exported && (
              <span className="text-xs text-fg-positive" role="status">
                {`audit-log.csv · ${rows(data.total)} downloaded`}
              </span>
            )}
            <Button
              variant="secondary"
              icon={<IconDownload />}
              href={query ? `/audit/export?${query}` : '/audit/export'}
              download
              onClick={() => setExported(true)}
              disabled={data.total === 0}
            >
              {filtered ? `Export ${rows(data.total)}` : 'Export CSV'}
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SegmentedControl
            label="Category"
            size="sm"
            options={[...AUDIT_CATEGORIES]}
            value={f.cat}
            onChange={(v) => go({ ...f, cat: v as AuditCategory })}
          />
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Select
                label="Actor"
                icon={<IconUser />}
                options={data.actors}
                value={f.actor}
                onChange={(e) => go({ ...f, actor: e.target.value })}
              />
            </div>
            <div className="w-44">
              <Select
                label="When"
                icon={<IconCalendar />}
                options={AUDIT_RANGES.map((r) => ({ value: r, label: r }))}
                value={f.range}
                onChange={(e) => go({ ...f, range: e.target.value as AuditRange })}
              />
            </div>
          </div>
        </div>
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-2 text-sm text-fg-secondary">
          <span aria-live="polite">{countLine(data)}</span>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              icon={<IconX />}
              onClick={() => go({ cat: 'All', actor: 'everyone', range: DEFAULT_RANGE })}
            >
              Clear filters
            </Button>
          )}
        </div>

        <DataTable
          label="Audit log entries"
          columns={columns}
          rows={data.entries}
          rowKey="id"
          rowHeight="auto"
          pageSize={TABLE_PAGE}
          loading={pending}
          empty={{
            icon: <IconSearch />,
            title: 'No entries match these filters.',
            ...(filtered
              ? {
                  action: (
                    <Button
                      variant="secondary"
                      icon={<IconX />}
                      onClick={() => go({ cat: 'All', actor: 'everyone', range: DEFAULT_RANGE })}
                    >
                      Clear filters
                    </Button>
                  ),
                }
              : {}),
          }}
        />
      </div>

      <p className="flex items-start gap-3 text-sm leading-normal text-fg-secondary">
        <span className="flex pt-0.5">
          <IconLock size="sm" />
        </span>
        <span>
          Entries are kept forever and can’t be edited or deleted. “System” rows are written by the status
          engine and the notifier.
        </span>
      </p>
    </div>
  );
}
