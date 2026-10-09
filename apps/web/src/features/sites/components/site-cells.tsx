import { Badge } from '@jirawatpyk/aura-react';
import { IconCircleDotDashed, IconPencil } from '@jirawatpyk/aura-react/icons';
import { SiteStatusBadge } from '@/components/status-badges';
import { GlyphRow, MutedOverlay } from '@/components/site-cells';
import type { SiteListRow } from '../types';
import { rowKey } from './site-list';

// The cells the Overview draws too live in components/site-cells (S06b); the Sites-only ones stay here.
export {
  GLYPH_LEGEND,
  GLYPHS,
  IncidentLink,
  incidentText,
  incidentTone,
  TOUCH_HIT,
} from '@/components/site-cells';

export function LocationGlyphs({ row }: { row: Pick<SiteListRow, 'live' | 'locations'> }) {
  if (!row.live) return <span className="text-fg-secondary">—</span>;
  return <GlyphRow locations={row.locations} />;
}

/** Not monitored (a Draft) or no round yet (a live site before its first check). */
export function RowStatusBadge({ row }: { row: Pick<SiteListRow, 'live' | 'status'> }) {
  const key = rowKey(row);
  if (key === 'draft') {
    return (
      <Badge tone="neutral" variant="outline" icon={<IconCircleDotDashed />}>
        Not monitored
      </Badge>
    );
  }
  if (key === 'pending') {
    return (
      <Badge tone="neutral" variant="outline" icon={<IconCircleDotDashed />}>
        No data yet
      </Badge>
    );
  }
  return <SiteStatusBadge status={key} />;
}

/** Muted is an overlay under the status, never a status (spec §11). */
export function MutedBadge({ row, now }: { row: Pick<SiteListRow, 'mutedUntil'>; now: Date }) {
  return <MutedOverlay mutedUntil={row.mutedUntil} now={now} />;
}

export function DraftBadge() {
  return (
    <Badge tone="neutral" variant="outline" icon={<IconPencil />}>
      Draft · not monitored
    </Badge>
  );
}
