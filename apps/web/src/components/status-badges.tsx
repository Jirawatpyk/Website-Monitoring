import type { ReactElement } from 'react';
import { Badge, type Tone } from '@jirawatpyk/aura-react';
import {
  IconArrowUpRight,
  IconBan,
  IconCalendar,
  IconCheck,
  IconCircleCheck,
  IconClock,
  IconEye,
  IconFileText,
  IconPencil,
  IconTriangleAlert,
} from '@jirawatpyk/aura-react/icons';
import type { IncidentState, Severity, SiteStatus } from '@dxt/shared';

type BadgeSpec = { tone: Tone; variant: 'outline' | 'soft'; icon: ReactElement | undefined; label: string };

/** Incident workflow state (spec §11): never solid red, never the ban icon. */
const WORKFLOW: Record<IncidentState, BadgeSpec> = {
  unacked: { tone: 'danger', variant: 'outline', icon: <IconClock />, label: 'Unacked' },
  escalated: { tone: 'warning', variant: 'outline', icon: <IconArrowUpRight />, label: 'Escalated' },
  acknowledged: { tone: 'neutral', variant: 'outline', icon: <IconCheck />, label: 'Acknowledged' },
  monitoring: { tone: 'neutral', variant: 'outline', icon: <IconEye />, label: 'Monitoring' },
  needs_root_cause: { tone: 'warning', variant: 'outline', icon: <IconPencil />, label: 'Needs root cause' },
  resolved: { tone: 'success', variant: 'outline', icon: <IconCircleCheck />, label: 'Resolved' },
  in_review: { tone: 'neutral', variant: 'outline', icon: <IconFileText />, label: 'In review' },
  closed: { tone: 'neutral', variant: 'soft', icon: undefined, label: 'Closed' },
};

export function WorkflowBadge({ state, level }: { state: IncidentState; level?: number }) {
  const b = WORKFLOW[state];
  return (
    <Badge tone={b.tone} variant={b.variant} icon={b.icon}>
      {state === 'escalated' && level ? `${b.label} · L${level}` : b.label}
    </Badge>
  );
}

/**
 * An incident's severity (spec §11): Down = danger solid ban, Problem = warning soft triangle-alert;
 * once recovered it shows as outline ("Was down"), as in lists of past items.
 */
export function SeverityBadge({ severity, recovered }: { severity: Severity; recovered: boolean }) {
  if (severity === 'problem') {
    return (
      <Badge tone="warning" variant={recovered ? 'outline' : 'soft'} icon={<IconTriangleAlert />}>
        {recovered ? 'Was problem' : 'Problem'}
      </Badge>
    );
  }
  return recovered ? (
    <Badge tone="danger" variant="outline" icon={<IconBan />}>
      Was down
    </Badge>
  ) : (
    <Badge tone="danger" variant="solid" icon={<IconBan />}>
      Down
    </Badge>
  );
}

/**
 * A site's status (spec §11, §14.2): Down = danger solid ban, Problem = warning soft triangle-alert,
 * OK = success soft circle-check, Maintenance = accent soft calendar (accent is Maintenance's only).
 */
const SITE: Record<SiteStatus, Omit<BadgeSpec, 'variant'> & { variant: 'outline' | 'soft' | 'solid' }> = {
  down: { tone: 'danger', variant: 'solid', icon: <IconBan />, label: 'Down' },
  problem: { tone: 'warning', variant: 'soft', icon: <IconTriangleAlert />, label: 'Problem' },
  ok: { tone: 'success', variant: 'soft', icon: <IconCircleCheck />, label: 'OK' },
  maintenance: { tone: 'accent', variant: 'soft', icon: <IconCalendar />, label: 'Maintenance' },
};

export function SiteStatusBadge({ status }: { status: SiteStatus }) {
  const b = SITE[status];
  return (
    <Badge tone={b.tone} variant={b.variant} icon={b.icon}>
      {b.label}
    </Badge>
  );
}
