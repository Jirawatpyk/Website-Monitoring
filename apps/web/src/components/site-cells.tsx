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
  IconShieldAlert,
} from '@jirawatpyk/aura-react/icons';
import { formatDay, formatIncidentLine, formatTime, isSameBangkokDay } from '@dxt/shared';

/**
 * Cells a site's status is drawn with on Sites, Site detail and the Overview (spec §11, §20, §21):
 * the BKK / SIN / TYO glyphs, the Muted overlay and the open incident's link. Shared by those
 * features, so it lives here rather than in one of them.
 */

/** What one location's latest check looks like (the §11 legend). */
export type LocationGlyph = 'pass' | 'fail' | 'blocked' | 'slow' | 'chain' | 'none';

export const SITE_LOCATIONS = ['BKK', 'SIN', 'TYO'] as const;
export type SiteLocation = (typeof SITE_LOCATIONS)[number];

/**
 * A short text link's 44 px tap area on touch screens (spec §14.17), without moving the text, and
 * AURA's focus ring (the browser's default otherwise, S06 /verify).
 */
export const TOUCH_HIT =
  "relative rounded-aura-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:top-1/2 pointer-coarse:after:h-11 pointer-coarse:after:-translate-y-1/2 pointer-coarse:after:content-['']";

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

export function GlyphRow({ locations }: { locations: Record<SiteLocation, LocationGlyph> }) {
  return (
    <span className="flex items-center gap-3">
      {SITE_LOCATIONS.map((loc) => {
        const g = GLYPHS[locations[loc]];
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

/** "18:00" today, "Mon 12 Oct 09:00" on a later day. */
export function untilText(until: Date, now: Date): string {
  return isSameBangkokDay(until, now)
    ? formatTime(until)
    : `${formatDay(until, { weekday: true })} ${formatTime(until)}`;
}

/** Muted is an overlay under the status, never a status (spec §11); nothing once the mute has ended. */
export function MutedOverlay({ mutedUntil, now }: { mutedUntil: string | null; now: Date }) {
  if (!mutedUntil || new Date(mutedUntil) <= now) return null;
  return (
    <Badge tone="neutral" variant="outline" icon={<IconEyeOff />}>
      {`Muted · until ${untilText(new Date(mutedUntil), now)}`}
    </Badge>
  );
}

/** The open incident shown under a site's status (any state before Resolved). */
export interface IncidentLinkData {
  id: string;
  number: number;
  state: 'unacked' | 'escalated' | 'acknowledged' | 'monitoring' | 'needs_root_cause';
  level: number;
  detectedAt: string;
  ackedBy: string | null;
}

/** Waiting on someone (unacked, escalated) reads red; a missing root cause amber; the rest quiet. */
export function incidentTone(state: IncidentLinkData['state']): string {
  if (state === 'unacked' || state === 'escalated') return 'text-fg-danger';
  if (state === 'needs_root_cause') return 'text-alert-warning-fg';
  return 'text-fg-secondary';
}

export function incidentText(i: IncidentLinkData, now: Date): string {
  return formatIncidentLine({
    number: i.number,
    state: i.state,
    level: i.level,
    minutesOpen: (now.getTime() - new Date(i.detectedAt).getTime()) / 60_000,
    ackedBy: i.ackedBy,
  });
}

export function IncidentLink({
  incident,
  now,
  className = '',
}: {
  incident: IncidentLinkData;
  now: Date;
  className?: string;
}) {
  return (
    <Link
      href={`/incidents/${incident.id}`}
      className={`text-xs font-medium underline underline-offset-2 ${TOUCH_HIT} ${incidentTone(incident.state)} ${className}`}
    >
      {incidentText(incident, now)}
    </Link>
  );
}
