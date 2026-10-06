import { Badge, type IconName, type Tone } from '@jirawatpyk/aura-react';
import type { IncidentState, Severity } from '@dxt/shared';

type BadgeSpec = { tone: Tone; variant: 'outline' | 'soft'; icon: IconName | undefined; label: string };

/** Incident workflow state (spec §11): never solid red, never the ban icon. */
const WORKFLOW: Record<IncidentState, BadgeSpec> = {
  unacked: { tone: 'danger', variant: 'outline', icon: 'clock', label: 'Unacked' },
  escalated: { tone: 'warning', variant: 'outline', icon: 'arrow-up-right', label: 'Escalated' },
  acknowledged: { tone: 'neutral', variant: 'outline', icon: 'check', label: 'Acknowledged' },
  monitoring: { tone: 'neutral', variant: 'outline', icon: 'eye', label: 'Monitoring' },
  needs_root_cause: { tone: 'warning', variant: 'outline', icon: 'pencil', label: 'Needs root cause' },
  resolved: { tone: 'success', variant: 'outline', icon: 'circle-check', label: 'Resolved' },
  in_review: { tone: 'neutral', variant: 'outline', icon: 'file-text', label: 'In review' },
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
      <Badge tone="warning" variant={recovered ? 'outline' : 'soft'} icon="triangle-alert">
        {recovered ? 'Was a problem' : 'Problem'}
      </Badge>
    );
  }
  return recovered ? (
    <Badge tone="danger" variant="outline" icon="ban">
      Was down
    </Badge>
  ) : (
    <Badge tone="danger" variant="solid" icon="ban">
      Down
    </Badge>
  );
}
