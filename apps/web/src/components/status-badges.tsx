import { Badge, type IconName, type Tone } from '@jirawatpyk/aura-react';
import type { IncidentState } from '@dxt/shared';

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

/** A DOWN incident's severity (spec §11): solid while down, outline ("Was down") once recovered. */
export function DownBadge({ recovered }: { recovered: boolean }) {
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
