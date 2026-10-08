import Link from 'next/link';
import type { ReactElement } from 'react';
import { Badge } from '@jirawatpyk/aura-react';
import {
  IconBan,
  IconCircleCheck,
  IconCircleDotDashed,
  IconClock,
  IconEyeOff,
  IconLock,
  IconPencil,
  IconShieldAlert,
} from '@jirawatpyk/aura-react/icons';
import { formatDay, formatIncidentLine, formatTime, isSameBangkokDay } from '@dxt/shared';
import { SiteStatusBadge } from '@/components/status-badges';
import { LIST_LOCATIONS, type LocationGlyph, type OpenIncident, type SiteListRow } from '../types';
import { isMuted, rowKey } from './site-list';

/** A 44 px tap area around a short text link on touch screens (spec §14.17), without moving the text. */
export const TOUCH_HIT =
  "relative pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:top-1/2 pointer-coarse:after:h-11 pointer-coarse:after:-translate-y-1/2 pointer-coarse:after:content-['']";

/** One location's glyph (spec §11 legend): icon, colour class and the words a screen reader hears. */
export const GLYPHS: Record<LocationGlyph, { icon: ReactElement; tone: string; label: string }> = {
  pass: { icon: <IconCircleCheck />, tone: 'text-fg-positive', label: 'Pass' },
  fail: { icon: <IconBan />, tone: 'text-fg-danger', label: 'Hard fail' },
  blocked: { icon: <IconLock />, tone: 'text-fg-secondary', label: 'Blocked by bot protection' },
  slow: { icon: <IconClock />, tone: 'text-alert-warning-fg', label: 'Slow' },
  // D-029: a broken certificate chain is a PROBLEM, so it never takes the hard-fail glyph
  chain: { icon: <IconShieldAlert />, tone: 'text-alert-warning-fg', label: 'TLS chain error' },
  none: { icon: <IconCircleDotDashed />, tone: 'text-fg-tertiary', label: 'No data' },
};

/** The order the legend lists the glyphs in. */
export const GLYPH_LEGEND: readonly LocationGlyph[] = ['pass', 'fail', 'blocked', 'slow', 'chain', 'none'];

export function LocationGlyphs({ row }: { row: SiteListRow }) {
  if (!row.live) return <span className="text-fg-secondary">—</span>;
  return (
    <span className="flex items-center gap-3">
      {LIST_LOCATIONS.map((loc) => {
        const g = GLYPHS[row.locations[loc]];
        return (
          <span
            key={loc}
            className={`flex ${g.tone}`}
            role="img"
            aria-label={`${loc}: ${g.label}`}
            title={`${loc}: ${g.label}`}
          >
            {g.icon}
          </span>
        );
      })}
    </span>
  );
}

/** Not monitored (a Draft) or no round yet (a live site before its first check). */
export function RowStatusBadge({ row }: { row: SiteListRow }) {
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
export function MutedBadge({ row, now }: { row: SiteListRow; now: Date }) {
  if (!isMuted(row, now) || !row.mutedUntil) return null;
  return (
    <Badge tone="neutral" variant="outline" icon={<IconEyeOff />}>
      {`Muted · until ${untilText(new Date(row.mutedUntil), now)}`}
    </Badge>
  );
}

/** "18:00" today, "Mon 12 Oct 09:00" on a later day. */
function untilText(until: Date, now: Date): string {
  return isSameBangkokDay(until, now)
    ? formatTime(until)
    : `${formatDay(until, { weekday: true })} ${formatTime(until)}`;
}

export function DraftBadge() {
  return (
    <Badge tone="neutral" variant="outline" icon={<IconPencil />}>
      Draft · not monitored
    </Badge>
  );
}

/** Waiting on someone (unacked, escalated) reads red; a missing root cause amber; the rest quiet. */
export function incidentTone(state: OpenIncident['state']): string {
  if (state === 'unacked' || state === 'escalated') return 'text-fg-danger';
  if (state === 'needs_root_cause') return 'text-alert-warning-fg';
  return 'text-fg-secondary';
}

export function incidentText(i: OpenIncident, now: Date): string {
  return formatIncidentLine({
    number: i.number,
    state: i.state,
    level: i.level,
    minutesOpen: (now.getTime() - new Date(i.detectedAt).getTime()) / 60_000,
    ackedBy: i.ackedBy,
  });
}

export function IncidentLink({ incident, now }: { incident: OpenIncident; now: Date }) {
  return (
    <Link
      href={`/incidents/${incident.id}`}
      className={`text-xs font-medium underline underline-offset-2 ${TOUCH_HIT} ${incidentTone(incident.state)}`}
    >
      {incidentText(incident, now)}
    </Link>
  );
}
