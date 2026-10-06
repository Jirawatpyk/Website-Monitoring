import type { ReactElement } from 'react';
import { Badge, type Tone } from '@jirawatpyk/aura-react';
import {
  IconArrowUpRight,
  IconBan,
  IconCheck,
  IconCircleCheck,
  IconClock,
  IconEye,
  IconFileText,
  IconPencil,
  IconTriangleAlert,
} from '@jirawatpyk/aura-react/icons';
import type { IncidentState, Severity } from '@dxt/shared';

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
        {recovered ? 'Was a problem' : 'Problem'}
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
