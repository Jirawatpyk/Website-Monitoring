'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type ReactElement } from 'react';
import {
  Avatar,
  Badge,
  Button,
  DataTable,
  DropdownMenu,
  EmptyState,
  FilterBar,
  FilterSelect,
  IconButton,
  Switch,
  Tag,
  type ActiveFilter,
  type DataTableColumn,
  type MenuItem,
} from '@jirawatpyk/aura-react';
import {
  IconBan,
  IconCalendar,
  IconChevronRight,
  IconCircleCheck,
  IconCircleDotDashed,
  IconEllipsis,
  IconExternalLink,
  IconEyeOff,
  IconMonitor,
  IconPencil,
  IconSearch,
  IconTriangleAlert,
  IconX,
} from '@jirawatpyk/aura-react/icons';
import { formatPercent, formatTier, formatTimeWithSeconds } from '@dxt/shared';
import { SiteStatusBadge } from '@/components/status-badges';
import type { SiteListRow } from '../types';
import {
  DraftBadge,
  TOUCH_HIT,
  GLYPH_LEGEND,
  GLYPHS,
  IncidentLink,
  incidentText,
  incidentTone,
  LocationGlyphs,
  MutedBadge,
  RowStatusBadge,
} from './site-cells';
import {
  filterSites,
  isMuted,
  matches,
  needsAttention,
  NO_FILTERS,
  rowKey,
  SORT_LABELS,
  SORT_WORDS,
  SORTS,
  sortSites,
  statusCounts,
  type RowKey,
  type SiteListFilters,
  type SortKey,
  type StatusFilter,
} from './site-list';
import { CHECKED_FROM, COLUMN_WIDTH as W, LATE_FROM } from './site-table-layout';

interface SitesListProps {
  sites: SiteListRow[];
  isAdmin: boolean;
  /** The signed-in person, for "Mine". */
  meId: string;
  /** Server time of the render (ISO), so server and client agree on mutes and "18 min unacked". */
  nowIso: string;
}

const STATUS_CHIPS: { value: StatusFilter; label: string; icon?: ReactElement }[] = [
  { value: 'all', label: 'All' },
  { value: 'down', label: 'Down', icon: <IconBan /> },
  { value: 'problem', label: 'Problem', icon: <IconTriangleAlert /> },
  { value: 'maintenance', label: 'Maintenance', icon: <IconCalendar /> },
  { value: 'ok', label: 'OK', icon: <IconCircleCheck /> },
  { value: 'muted', label: 'Muted', icon: <IconEyeOff /> },
  { value: 'draft', label: 'Drafts', icon: <IconCircleDotDashed /> },
];

// The status names the applied-filter chip uses ("Status: Down"); status is picked with the chip row.
// FilterSelect draws its own name before the chosen option, so the other options carry the value only.
const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'down', label: 'Down' },
  { value: 'problem', label: 'Problem' },
  { value: 'ok', label: 'OK' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'muted', label: 'Muted' },
  { value: 'draft', label: 'Drafts' },
];

const TIER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
];

/** Mobile groups, in the default order (MSites). */
const GROUPS: { key: RowKey; title: string }[] = [
  { key: 'down', title: 'DOWN' },
  { key: 'problem', title: 'PROBLEM' },
  { key: 'maintenance', title: 'MAINTENANCE' },
  { key: 'ok', title: 'OK' },
  { key: 'pending', title: 'NO DATA YET' },
  { key: 'draft', title: 'DRAFT' },
];

const NOT_YET = 'Comes with maintenance windows';

function labelOf(options: { value: string; label: string }[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

/**
 * `/sites` — the management list (spec §20, boards Sites and MSites). A table from md up, a list grouped
 * by status on phones; one set of filters drives both.
 */
export function SitesList({ sites, isAdmin, meId, nowIso }: SitesListProps) {
  const router = useRouter();
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const [f, setF] = useState<SiteListFilters>(NO_FILTERS);
  const [sort, setSort] = useState<SortKey>('status');
  const ctx = { meId, now };
  const set = (patch: Partial<SiteListFilters>) => setF((prev) => ({ ...prev, ...patch }));

  const shown = sortSites(filterSites(sites, f, ctx), sort);
  const counts = statusCounts(sites, now);
  const attentionCount = sites.filter((r) => matches(r, f, ctx, 'attention') && needsAttention(r)).length;
  const mineCount = sites.filter((r) => r.owner?.id === meId || r.backup?.id === meId).length;

  const ownerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of sites) if (s.owner) seen.set(s.owner.id, s.owner.name);
    return [
      { value: 'all', label: 'All' },
      { value: 'mine', label: 'Mine' },
      ...[...seen].sort((a, b) => a[1].localeCompare(b[1])).map(([value, name]) => ({ value, label: name })),
    ];
  }, [sites]);
  const clientOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of sites) if (!s.client.internal) seen.set(s.client.id, s.client.name);
    return [
      { value: 'all', label: 'All' },
      ...[...seen].sort((a, b) => a[1].localeCompare(b[1])).map(([value, name]) => ({ value, label: name })),
      { value: 'internal', label: 'Internal' },
    ];
  }, [sites]);

  const active: ActiveFilter[] = [];
  if (f.q.trim()) active.push({ id: 'q', label: `Search: “${f.q.trim()}”`, onRemove: () => set({ q: '' }) });
  if (f.status !== 'all')
    active.push({
      id: 'status',
      label: `Status: ${labelOf(STATUS_OPTIONS, f.status)}`,
      onRemove: () => set({ status: 'all' }),
    });
  if (f.tier !== 'all')
    active.push({ id: 'tier', label: `Tier ${f.tier}`, onRemove: () => set({ tier: 'all' }) });
  if (f.owner !== 'all')
    active.push({
      id: 'owner',
      label:
        f.owner === 'mine' ? 'Owner: mine (owner or backup)' : `Owner: ${labelOf(ownerOptions, f.owner)}`,
      onRemove: () => set({ owner: 'all' }),
    });
  if (f.client !== 'all')
    active.push({
      id: 'client',
      label: `Client: ${labelOf(clientOptions, f.client)}`,
      onRemove: () => set({ client: 'all' }),
    });
  if (f.attention)
    active.push({ id: 'attention', label: 'Needs attention', onRemove: () => set({ attention: false }) });

  // "Clear" resets the filters and keeps the sort (spec §20).
  const clearAll = () => setF(NO_FILTERS);
  const total = sites.length;
  const countLine =
    shown.length !== total
      ? `Showing ${shown.length} of ${total}`
      : total === 1
        ? '1 site'
        : `All ${total} sites`;

  /** A row opens Site detail for everyone (spec §20); a Draft opens Add site's form to finish setup, for Admins only. */
  const hrefOf = (r: SiteListRow) => (r.live ? `/sites/${r.id}` : isAdmin ? `/sites/${r.id}/edit` : null);

  const menuItems = (r: SiteListRow): MenuItem[] => [
    ...(r.live ? [{ label: 'Open', icon: <IconMonitor />, href: `/sites/${r.id}` }] : []),
    ...(isAdmin ? [{ label: 'Edit site', icon: <IconPencil />, href: `/sites/${r.id}/edit` }] : []),
    ...(r.live || isAdmin ? [{ separator: true as const }] : []),
    {
      label: isMuted(r, now) ? 'End or edit mute…' : 'Mute…',
      icon: <IconEyeOff />,
      disabled: true,
      disabledReason: NOT_YET,
    },
    {
      label: r.status === 'maintenance' ? 'End or edit maintenance…' : 'Schedule maintenance',
      icon: <IconCalendar />,
      disabled: true,
      disabledReason: NOT_YET,
    },
  ];

  // Widths and the table widths the optional columns appear at: site-table-layout.ts (tested to fit).
  const columns: DataTableColumn<SiteListRow>[] = [
    {
      key: 'status',
      label: 'Status',
      width: W.status,
      render: (r) => (
        <span className="flex flex-col items-start gap-1 py-2">
          <RowStatusBadge row={r} />
          <MutedBadge row={r} now={now} />
          {r.openIncident && <IncidentLink incident={r.openIncident} now={now} />}
        </span>
      ),
    },
    {
      key: 'name',
      label: 'Site',
      render: (r) => {
        const href = hrefOf(r);
        return (
          <span className="flex min-w-0 flex-col items-start gap-0.5 py-2">
            {href ? (
              <Link
                href={href}
                className={`max-w-full font-medium text-fg-primary hover:underline ${TOUCH_HIT}`}
              >
                {/* truncate inside, so the 44 px tap area isn't clipped */}
                <span className="block truncate">{r.name}</span>
              </Link>
            ) : (
              <span className="max-w-full truncate font-medium">{r.name}</span>
            )}
            {!r.live && <DraftBadge />}
            <span className="max-w-full truncate text-xs text-fg-secondary">
              {r.client.internal
                ? 'Internal'
                : `${r.client.name}${r.client.amName ? ` · AM ${r.client.amName}` : ''}`}
            </span>
            {r.url && <span className="max-w-full truncate font-mono text-xs text-fg-tertiary">{r.url}</span>}
          </span>
        );
      },
    },
    {
      key: 'tier',
      label: 'Tier',
      width: W.tier,
      mono: true,
      render: (r) => formatTier(r.tier, { short: true }),
    },
    {
      key: 'owner',
      label: 'Owner · backup',
      width: W.owner,
      hideBelow: 'lg',
      render: (r) =>
        r.owner ? (
          <span className="flex items-center gap-2">
            <Avatar name={r.owner.name} size="sm" />
            <span className="flex min-w-0 flex-col leading-tight">
              {/* full names run long (first name, nickname, surname): two lines, the whole name on hover */}
              <span className="line-clamp-2 text-sm" title={r.owner.name}>
                {r.owner.name}
              </span>
              <span className="truncate text-xs text-fg-secondary" title={r.backup?.name}>
                {r.backup?.name ?? 'No backup'}
              </span>
            </span>
          </span>
        ) : (
          <span className="text-fg-secondary">—</span>
        ),
    },
    { key: 'locations', label: 'BKK SIN TYO', width: W.locations, render: (r) => <LocationGlyphs row={r} /> },
    {
      key: 'p50',
      label: 'Response 24h',
      width: W.p50,
      hideBelow: LATE_FROM,
      render: (r) => <span className="text-fg-secondary">{r.p50Ms === null ? '—' : `${r.p50Ms} ms`}</span>,
    },
    {
      key: 'uptime',
      label: 'Uptime 30d',
      width: W.uptime,
      hideBelow: 'lg',
      render: (r) => (
        <span className={r.uptime30d === null ? 'text-fg-secondary' : ''}>
          {r.uptime30d === null ? '—' : formatPercent(r.uptime30d)}
        </span>
      ),
    },
    {
      key: 'expiry',
      label: 'Expiry',
      width: W.expiry,
      hideBelow: LATE_FROM,
      render: (r) => (
        <span className="text-fg-secondary">{r.expiryDays === null ? '—' : `${r.expiryDays} d`}</span>
      ),
    },
    {
      key: 'checkedAt',
      label: 'Checked',
      width: W.checked,
      hideBelow: CHECKED_FROM,
      mono: true,
      render: (r) => (
        <span className="whitespace-nowrap">
          {r.checkedAt ? formatTimeWithSeconds(new Date(r.checkedAt)) : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      label: '',
      width: W.actions,
      actions: true,
      render: (r) =>
        r.live ? (
          <span className="flex items-center justify-end gap-1">
            {r.url && (
              <Button
                variant="secondary"
                size="sm"
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                iconRight={<IconExternalLink />}
                aria-label={`Visit site: ${r.name} (opens in a new tab)`}
              >
                Visit site
              </Button>
            )}
            {isAdmin && (
              <DropdownMenu
                label={`Actions for ${r.name}`}
                trigger={<IconButton icon={<IconEllipsis />} label={`Actions for ${r.name}`} />}
                items={menuItems(r)}
              />
            )}
          </span>
        ) : isAdmin ? (
          <Button variant="secondary" size="sm" icon={<IconPencil />} href={`/sites/${r.id}/edit`}>
            Finish setup
          </Button>
        ) : (
          <span className="text-right text-xs text-fg-secondary">Only an Admin can finish setup</span>
        ),
    },
  ];

  const noMatch = (
    <EmptyState
      bordered
      icon={<IconSearch />}
      headingLevel={2}
      title={`No sites match ${active.map((a) => a.label).join(' · ')}`}
      description={`${total === 1 ? 'The site is' : `All ${total} sites are`} still there — only this list is filtered.`}
      action={
        <Button variant="secondary" icon={<IconX />} onClick={clearAll}>
          Clear filters
        </Button>
      }
    />
  );
  /** Anything besides the search narrows the list — the phone's "All" chip is on only without it. */
  const narrowed =
    f.status !== 'all' || f.tier !== 'all' || f.owner !== 'all' || f.client !== 'all' || f.attention;

  return (
    <div className="flex flex-col gap-4">
      {/* ── desktop and tablet ── */}
      <div className="hidden flex-col gap-3 md:flex">
        <div role="group" aria-label="Sites by status" className="flex flex-wrap items-center gap-2">
          {STATUS_CHIPS.map((c) => (
            <Tag
              key={c.value}
              touchHeight
              icon={c.icon}
              selected={f.status === c.value}
              onClick={() => set({ status: f.status === c.value && c.value !== 'all' ? 'all' : c.value })}
            >
              {`${c.label} ${counts[c.value]}`}
            </Tag>
          ))}
        </div>

        <FilterBar
          search={f.q}
          onSearchChange={(q) => set({ q })}
          searchLabel="Search sites"
          searchPlaceholder="Search name, URL or client"
        >
          {/* status is the chip row above (Tao, 8 Oct 2026: one control per filter) */}
          <FilterSelect
            label="Tier"
            allLabel="all"
            options={TIER_OPTIONS}
            value={f.tier}
            onChange={(v) => set({ tier: v as SiteListFilters['tier'] })}
          />
          <FilterSelect
            label="Owner"
            allLabel="all"
            options={ownerOptions}
            value={f.owner}
            onChange={(owner) => set({ owner })}
          />
          <FilterSelect
            label="Client"
            allLabel="all"
            options={clientOptions}
            value={f.client}
            onChange={(client) => set({ client })}
          />
        </FilterBar>

        <div className="flex">
          <Switch
            label={`Needs attention (${attentionCount})`}
            description="Open incident · draft (setup not finished) · SSL or domain < 60 d · no backup"
            checked={f.attention}
            onChange={(attention) => set({ attention })}
          />
        </div>

        <div className="flex min-h-8 flex-wrap items-center gap-2 text-sm text-fg-secondary">
          <span className="font-medium text-fg-primary" aria-live="polite">
            {countLine}
          </span>
          {active.length > 0 ? (
            <>
              <span>·</span>
              {active.map((a) => (
                <Tag key={a.id} onRemove={a.onRemove} removeLabel={`Remove filter ${a.label}`}>
                  {a.label}
                </Tag>
              ))}
              <Button variant="ghost" size="sm" icon={<IconX />} onClick={clearAll}>
                Clear
              </Button>
            </>
          ) : (
            <span>{`· sorted by ${SORT_WORDS[sort]}`}</span>
          )}
          <span className="ml-auto">
            <FilterSelect
              label="Sort by"
              options={SORTS.map((s) => ({ value: s, label: SORT_LABELS[s] }))}
              value={sort}
              onChange={(v) => setSort(v as SortKey)}
            />
          </span>
        </div>

        {shown.length === 0 ? (
          noMatch
        ) : (
          <DataTable
            label="Sites"
            rowKey="id"
            columns={columns}
            rows={shown}
            rowHeight="auto"
            onRowActivate={(r) => {
              const href = hrefOf(r);
              if (href) router.push(href);
            }}
          />
        )}

        <Legend />
      </div>

      {/* ── phones (MSites) ── */}
      <div className="flex flex-col gap-3 md:hidden">
        <FilterBar
          search={f.q}
          onSearchChange={(q) => set({ q })}
          searchLabel="Search sites"
          searchPlaceholder="Search name, URL or client"
          label="Search"
        />
        <div className="flex items-center">
          <div
            role="group"
            aria-label="Filter sites"
            // a row of chips that scrolls on purpose (layout-consistency skips it)
            data-scroll-x
            className="-mx-aura-4 flex min-w-0 grow gap-2 overflow-x-auto px-aura-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {STATUS_CHIPS.filter((c) => c.value !== 'ok').map((c) => (
              <Tag
                key={c.value}
                touchHeight
                selected={c.value === 'all' ? !narrowed : f.owner !== 'mine' && f.status === c.value}
                onClick={() =>
                  c.value === 'all' ? setF({ ...NO_FILTERS, q: f.q }) : set({ status: c.value, owner: 'all' })
                }
                className="shrink-0"
              >
                {`${c.label} ${counts[c.value]}`}
              </Tag>
            ))}
            <Tag
              touchHeight
              selected={f.owner === 'mine'}
              onClick={() => set({ status: 'all', owner: 'mine' })}
              className="shrink-0"
            >
              {`Mine ${mineCount}`}
            </Tag>
          </div>
        </div>
        <span className="sr-only" aria-live="polite">
          {active.length > 0 ? `Showing ${shown.length} of ${total}` : ''}
        </span>
        {active.length > 0 && (
          // filters set on a wider screen stay on; Clear reaches them here too
          <div className="flex items-center gap-2 text-xs text-fg-secondary">
            <span>{`Showing ${shown.length} of ${total}`}</span>
            <Button variant="ghost" size="sm" touchHeight icon={<IconX />} onClick={clearAll}>
              Clear
            </Button>
          </div>
        )}
        {shown.length === 0
          ? noMatch
          : GROUPS.map((g) => {
              const rows = shown.filter((r) => rowKey(r) === g.key);
              if (rows.length === 0) return null;
              return (
                <div key={g.key} className="flex flex-col gap-1.5">
                  <h2 className="pl-0.5 font-mono text-xs font-normal text-fg-tertiary">{`${g.title} · ${rows.length}`}</h2>
                  <ul className="overflow-hidden rounded-aura-lg border border-border-default bg-bg-surface">
                    {rows.map((r) => (
                      <li key={r.id} className="border-b border-border-subtle last:border-b-0">
                        <PhoneRow row={r} href={hrefOf(r)} now={now} />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
      </div>
    </div>
  );
}

function PhoneRow({ row, href, now }: { row: SiteListRow; href: string | null; now: Date }) {
  const sub = row.openIncident
    ? incidentText(row.openIncident, now)
    : row.live
      ? `${formatTier(row.tier)} · ${row.uptime30d === null ? '—' : formatPercent(row.uptime30d)} · 30 d`
      : formatTier(row.tier);
  const body = (
    <>
      <span className="flex w-30 shrink-0">
        <RowStatusBadge row={row} />
      </span>
      <span className="flex min-w-0 grow flex-col items-start gap-0.5 leading-snug">
        <span className="max-w-full truncate font-medium">{row.name}</span>
        <MutedBadge row={row} now={now} />
        {!row.live && <DraftBadge />}
        {!href && row.openIncident ? (
          <IncidentLink incident={row.openIncident} now={now} />
        ) : (
          <span
            className={`max-w-full text-xs ${row.openIncident ? `font-medium ${incidentTone(row.openIncident.state)}` : 'text-fg-secondary'}`}
          >
            {sub}
          </span>
        )}
        {!href && !row.live && (
          <span className="text-xs text-fg-secondary">Only an Admin can finish setup</span>
        )}
      </span>
    </>
  );
  if (!href) return <div className="flex min-h-15 items-center gap-2.5 py-2 pr-3.5 pl-3.5">{body}</div>;
  return (
    <Link
      href={href}
      className="flex min-h-15 items-center gap-2.5 py-2 pr-2 pl-3.5 text-fg-primary no-underline hover:bg-bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
    >
      {body}
      <span className="flex text-fg-tertiary">
        <IconChevronRight />
      </span>
    </Link>
  );
}

const STATUS_LEGEND: { key: string; badge: ReactElement; text: string }[] = [
  { key: 'down', badge: <SiteStatusBadge status="down" />, text: 'hard fail at 2 of 3 locations, twice' },
  {
    key: 'problem',
    badge: <SiteStatusBadge status="problem" />,
    text: 'slow, key page, keyword, regional, SSL or domain',
  },
  { key: 'maintenance', badge: <SiteStatusBadge status="maintenance" />, text: 'planned window' },
  { key: 'ok', badge: <SiteStatusBadge status="ok" />, text: 'every check passes' },
  {
    key: 'muted',
    badge: (
      <Badge tone="neutral" variant="outline" icon={<IconEyeOff />}>
        Muted
      </Badge>
    ),
    text: 'alerts off, status unchanged',
  },
  {
    key: 'draft',
    badge: (
      <Badge tone="neutral" variant="outline" icon={<IconCircleDotDashed />}>
        Not monitored
      </Badge>
    ),
    text: 'draft, no checks yet',
  },
];

/** What each column means (the board's notes, one per line). */
const COLUMN_NOTES: { term: string; text: string }[] = [
  {
    term: 'Uptime 30d',
    text: 'DOWN minutes only — Problem counts as up, maintenance is excluded, muted time counts',
  },
  { term: 'Response 24h', text: 'median (p50) of the primary monitor; “—” while down or in maintenance' },
  { term: 'Expiry', text: 'the sooner of SSL and domain, in days' },
  { term: 'Checked', text: 'the last complete round' },
];

/** Legend card (Tao, 8 Oct 2026): status and locations side by side from md with columns under them,
 * all three side by side from xl. Phones have no legend (MSites): each row says it in words. */
function Legend() {
  return (
    <section
      aria-label="Legend"
      className="mt-3 grid gap-x-8 gap-y-5 rounded-aura-lg border border-border-subtle p-aura-4 text-xs leading-normal text-fg-secondary md:grid-cols-2 xl:grid-cols-3"
    >
      <div className="flex flex-col gap-2">
        <h2 className="font-mono text-xs font-normal text-fg-tertiary">STATUS</h2>
        <ul className="flex flex-col gap-2">
          {STATUS_LEGEND.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <span className="flex w-30 shrink-0">{s.badge}</span>
              <span>{s.text}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="font-mono text-xs font-normal text-fg-tertiary">LOCATIONS</h2>
        <ul className="flex flex-col gap-2">
          {GLYPH_LEGEND.map((g) => (
            <li key={g} className="flex min-h-5 items-center gap-2">
              <span className={`flex ${GLYPHS[g].tone}`}>{GLYPHS[g].icon}</span>
              <span>{GLYPHS[g].label}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-2 md:col-span-2 xl:col-span-1">
        <h2 className="font-mono text-xs font-normal text-fg-tertiary">COLUMNS</h2>
        <dl className="flex flex-col gap-2">
          {COLUMN_NOTES.map((c) => (
            <div key={c.term}>
              <dt className="inline font-semibold text-fg-primary">{c.term}</dt>{' '}
              <dd className="inline">{c.text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
