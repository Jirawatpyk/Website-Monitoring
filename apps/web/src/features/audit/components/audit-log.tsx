'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
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
  IconFileText,
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
  ENTITY_FILTERS,
  NO_FILTERS,
  PAGE_LIMIT,
  filtersQuery,
  isFiltered,
  isNarrowed,
  spanLabel,
  type AuditCategory,
  type AuditFilters,
  type AuditRange,
} from '../model';

/** Rows per table page: up to PAGE_LIMIT entries load, the table shows them 50 at a time (D-061). */
const TABLE_PAGE = 50;
/** The table width the Entity column joins from: Tailwind `@4xl` (56rem), the folded line's breakpoint. */
const ENTITY_FROM = 896;
/**
 * A filter change waits this long before it loads: arrow keys on Category select at each press, and
 * each load reads up to 500 rows (spec-checker M4). The controls show the new value at once.
 */
export const FILTER_DEBOUNCE_MS = 300;

const entries = (n: number) => (n === 1 ? '1 entry' : `${formatCount(n)} entries`);
const rows = (n: number) => (n === 1 ? '1 row' : `${formatCount(n)} rows`);

/** The line under the filters: "34 entries · Fri 18 Sep → Fri 25 Sep 10:07 · filtered from 120". */
export function countLine(data: Pick<AuditPage, 'total' | 'unfiltered' | 'filters' | 'nowIso'>): string {
  const f = data.filters;
  const span = spanLabel(f.range, new Date(data.nowIso));
  const only = f.entity ? ` · ${ENTITY_FILTERS[f.entity] ?? f.entity} only` : '';
  const head =
    data.total > PAGE_LIMIT
      ? `Newest ${formatCount(PAGE_LIMIT)} of ${entries(data.total)} · ${span}${only} · Export has them all`
      : `${entries(data.total)} · ${span}${only}`;
  return isNarrowed(f) ? `${head} · filtered from ${formatCount(data.unfiltered)}` : head;
}

/** The empty table when nothing narrows it: "Nothing logged in the last 7 days" (spec-checker L1). */
function quietWords(range: AuditRange): string {
  if (range === 'Today') return 'Nothing logged today';
  if (range === 'All time') return 'Nothing logged yet';
  return `Nothing logged in the ${range.toLowerCase()}`;
}

/** Audit log (board AuditLog, spec §16.11, D-061). Filters live in the URL; the server filters. */
export function AuditLogView({ data }: { data: AuditPage }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [exported, setExported] = useState(false);
  // The controls follow the person at once; the server's filters catch up after the load (M3).
  const [f, setF] = useState<AuditFilters>(data.filters);
  const serverQuery = filtersQuery(data.filters);
  const [seenQuery, setSeenQuery] = useState(serverQuery);
  if (seenQuery !== serverQuery) {
    // New filters from the server (a load finished, Back, a link): the controls take them.
    setSeenQuery(serverQuery);
    setF(data.filters);
  }
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const categoryRef = useRef<HTMLDivElement>(null);
  const focusCategory = useRef(false);
  useEffect(() => {
    // After Clear: once the cleared page is here (and its Clear button gone), focus Category (L2).
    if (!focusCategory.current) return;
    focusCategory.current = false;
    categoryRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [serverQuery]);

  const go = (next: AuditFilters, { now = false }: { now?: boolean } = {}) => {
    setExported(false);
    setF(next);
    clearTimeout(timer.current);
    const push = () => {
      const q = filtersQuery(next);
      startTransition(() => router.push(q ? `/audit?${q}` : '/audit', { scroll: false }));
    };
    if (now) push();
    else timer.current = setTimeout(push, FILTER_DEBOUNCE_MS);
  };
  const clear = () => {
    // The Clear button goes away with the filters: focus lands on Category, not the page (L2).
    focusCategory.current = true;
    go(NO_FILTERS, { now: true });
  };

  // The export follows what the server shows, never a filter still waiting to load.
  const exportQuery = serverQuery;
  const filtered = isFiltered(data.filters);

  // Narrow tables fold Entity under the action, so the table fits from 768 px (M1):
  // 136 + 128 + 196 + 180 + 48 px of gutters = 688, inside the ~703 px a 1024 screen leaves it
  // (Time at 136: "Wed 30 Sep 16:20" on one line).
  // The column joins at a 896 px table (DataTable measures its own width), and the folded line
  // hides at the same width by a container query on the table wrapper (@4xl = 56rem = 896 px). The container is named:
  // DataTable wraps its cells in containers of its own (`aura-table-q`).
  const columns: DataTableColumn<AuditEntry>[] = [
    {
      key: 'at',
      label: 'Time',
      width: 136,
      render: (e) => (
        <time dateTime={e.at} className="py-1.5 font-mono text-xs text-fg-secondary">
          {e.atLabel}
        </time>
      ),
    },
    {
      key: 'actor',
      label: 'Actor',
      width: 128,
      render: (e) => (
        <span className="flex min-w-0 items-center gap-2">
          <Avatar name={e.actor} size="sm" />
          <span className="min-w-0 break-words">{e.actor}</span>
        </span>
      ),
    },
    {
      key: 'action',
      label: 'Action',
      width: 196,
      render: (e) => (
        <span className="flex min-w-0 flex-col py-1.5 leading-snug">
          <span className="font-medium break-words">{e.words}</span>
          <span className="font-mono text-xs break-all text-fg-tertiary">{e.action}</span>
          <span className="mt-1 break-words @4xl/audit:hidden">{e.entity}</span>
        </span>
      ),
    },
    {
      key: 'entity',
      label: 'Entity',
      width: 184,
      hideBelow: ENTITY_FROM,
      render: (e) => <span className="py-1.5 leading-snug break-words">{e.entity}</span>,
    },
    {
      key: 'change',
      label: 'Before → After',
      grow: 1,
      minWidth: 180,
      // Full values, wrapped: a title tooltip can't be read by keyboard or touch (M6).
      render: (e) => (
        <span className="flex min-w-0 items-start gap-2 py-1.5 font-mono text-xs leading-snug">
          <span
            className={`max-w-2/5 min-w-0 shrink-0 break-words text-fg-secondary ${e.struck ? 'line-through' : ''}`}
          >
            {e.before}
          </span>
          <span className="flex shrink-0 pt-px text-fg-tertiary">
            <IconArrowRight size="sm" aria-hidden />
            <span className="sr-only">to</span>
          </span>
          <span className="min-w-0 flex-1 break-words">{e.after}</span>
        </span>
      ),
    },
  ];

  const narrowed = isNarrowed(data.filters);

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
            {/* A plain <a>: a router Link would prefetch the export and run it in the background (H3). */}
            <Button
              variant="secondary"
              icon={<IconDownload />}
              href={exportQuery ? `/audit/export?${exportQuery}` : '/audit/export'}
              linkComponent="a"
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
          <div ref={categoryRef}>
            <SegmentedControl
              label="Category"
              options={[...AUDIT_CATEGORIES]}
              value={f.cat}
              onChange={(v) => go({ ...f, cat: v as AuditCategory })}
            />
          </div>
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
            <Button variant="ghost" size="sm" icon={<IconX />} onClick={clear}>
              Clear filters
            </Button>
          )}
        </div>

        <div className="@container/audit">
          <DataTable
            label="Audit log entries"
            columns={columns}
            rows={data.entries}
            rowKey="id"
            rowHeight="auto"
            pageSize={TABLE_PAGE}
            loading={pending}
            skeletonRows={Math.min(Math.max(data.entries.length, 3), 10)}
            empty={
              narrowed
                ? { icon: <IconSearch />, title: 'No entries match these filters.' }
                : {
                    icon: <IconFileText />,
                    title: quietWords(data.filters.range),
                    ...(data.filters.range !== 'All time'
                      ? {
                          action: (
                            <Button
                              variant="secondary"
                              onClick={() => {
                                // The button goes with the empty state: focus lands on Category (N3).
                                focusCategory.current = true;
                                go({ ...data.filters, range: 'All time' }, { now: true });
                              }}
                            >
                              Show all time
                            </Button>
                          ),
                        }
                      : {}),
                  }
            }
          />
        </div>
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
