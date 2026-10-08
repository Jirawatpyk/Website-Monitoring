'use client';

import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  DataTable,
  FilterSelect,
  SegmentedControl,
  type DataTableColumn,
} from '@jirawatpyk/aura-react';
import { IconExternalLink, IconSearch } from '@jirawatpyk/aura-react/icons';
import { formatTier, formatTimeWithSeconds } from '@dxt/shared';
import { SiteStatusBadge } from '@/components/status-badges';
import type { SiteListRow } from '../types';

interface SitesTableProps {
  sites: SiteListRow[];
  /** Admins open a row to edit it; others read the table only until site detail (S06). */
  canEdit: boolean;
}

const TIER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: '1', label: 'Tier 1' },
  { value: '2', label: 'Tier 2' },
  { value: '3', label: 'Tier 3' },
];

/**
 * `/sites` (docs/design/screens.md): the all-sites table of the Main board, full width, with its
 * Tier / owner / client filters. Locations, response and uptime join with S06's rollups (D-025).
 */
export function SitesTable({ sites, canEdit }: SitesTableProps) {
  const [tier, setTier] = useState('all');
  const [owner, setOwner] = useState('');
  const [client, setClient] = useState('');

  const owners = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of sites) if (s.owner) seen.set(s.owner.id, s.owner.name);
    return [...seen].map(([value, name]) => ({ value, label: name }));
  }, [sites]);

  const rows = sites.filter(
    (s) =>
      (tier === 'all' || String(s.tier) === tier) &&
      (!owner || s.owner?.id === owner) &&
      (!client || (client === 'internal') === s.client.internal),
  );

  const columns: DataTableColumn<SiteListRow>[] = [
    {
      key: 'status',
      label: 'Status',
      width: 132,
      render: (s) =>
        s.status ? (
          <SiteStatusBadge status={s.status} />
        ) : (
          <span className="text-sm text-fg-tertiary">{s.live ? 'No data yet' : '—'}</span>
        ),
    },
    {
      key: 'name',
      label: 'Site',
      render: (s) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{s.name}</span>
          {!s.live && (
            <Badge tone="neutral" variant="outline">
              Draft · not monitored
            </Badge>
          )}
        </span>
      ),
    },
    { key: 'tier', label: 'Tier', width: 64, mono: true, render: (s) => formatTier(s.tier, { short: true }) },
    { key: 'owner', label: 'Owner', width: 128, hideBelow: 'md', render: (s) => s.owner?.name ?? '—' },
    { key: 'client', label: 'Client', width: 168, hideBelow: 'lg', render: (s) => s.client.name },
    {
      key: 'checkedAt',
      label: 'Checked',
      width: 96,
      mono: true,
      hideBelow: 'md',
      render: (s) => (s.checkedAt ? formatTimeWithSeconds(new Date(s.checkedAt)) : '—'),
    },
    {
      key: 'visit',
      label: '',
      width: 64,
      actions: true,
      render: (s) =>
        s.url ? (
          <Button
            variant="ghost"
            size="sm"
            touchHeight
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            icon={<IconExternalLink />}
            aria-label={`Visit site: ${s.name} (opens in a new tab)`}
          >
            <span className="sr-only">Visit site</span>
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl label="Tier" options={TIER_OPTIONS} value={tier} onChange={setTier} />
        <FilterSelect label="Owner" allLabel="all" options={owners} value={owner} onChange={setOwner} />
        <FilterSelect
          label="Client"
          allLabel="all"
          options={[
            { value: 'client', label: 'Client sites' },
            { value: 'internal', label: 'Internal' },
          ]}
          value={client}
          onChange={setClient}
        />
      </div>
      <DataTable
        label="Sites"
        rowKey="id"
        columns={columns}
        rows={rows}
        getRowHref={canEdit ? (s) => `/sites/${s.id}/edit` : undefined}
        stackBelow={640}
        empty={{ icon: <IconSearch />, title: 'No sites match these filters.' }}
      />
    </div>
  );
}
