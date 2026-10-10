import { Badge, IconButton, Tag } from '@jirawatpyk/aura-react';
import {
  IconBell,
  IconCircleAlert,
  IconLock,
  IconMail,
  IconPencil,
  IconPin,
  IconTrash2,
  IconUser,
  IconUsers,
} from '@jirawatpyk/aura-react/icons';
import type { EscalationChannel, EscalationStep } from '@dxt/shared';
import type { ReactElement } from 'react';
import { stepCondition, stepErrors, stepNote, stepWhen, targetLabels, type PolicyDraft } from '../model';

const CHANNEL: Record<EscalationChannel, { label: string; icon: ReactElement }> = {
  chat: { label: 'Chat @mention', icon: <IconBell /> },
  space: { label: 'Alerts Space', icon: <IconUsers /> },
  email: { label: 'Email', icon: <IconMail /> },
  voice: { label: 'Voice call · configured, off until approved', icon: <IconLock /> },
};
const CHANNEL_ORDER: readonly EscalationChannel[] = ['chat', 'space', 'email', 'voice'];

/**
 * One step of a policy (Escalation board): the level dot, when and on what, its errors, who and which
 * channels, its note; pencil and delete. L0 is pinned (no pencil until S10 adds on-call, D-034).
 */
export function StepRow({
  policy,
  index,
  onEdit,
  onDelete,
}: {
  policy: PolicyDraft;
  index: number;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
}) {
  const step = policy.steps[index] as EscalationStep;
  const errs = stepErrors(policy.steps, index);
  const note = stepNote(policy, step);
  const pinned = index === 0;
  const label = `L${index}`;
  return (
    <li className="flex gap-4">
      <div className="flex w-10 shrink-0 flex-col items-center" aria-hidden>
        <span className="flex size-10 items-center justify-center rounded-full bg-bg-surface-strong font-mono text-xs text-fg-inverted">
          {label}
        </span>
        <span className="min-h-4 w-0.5 flex-1 bg-border-default" />
      </div>
      <div className="mb-3 flex min-w-0 flex-1 flex-col gap-3 rounded-aura-card-radius border border-border-default bg-bg-surface p-aura-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col">
            <h3 className="m-0 flex flex-wrap items-center gap-2 text-base font-semibold">
              <span className="sr-only">{label}: </span>
              {stepWhen(step)}
              {pinned && (
                <Badge tone="neutral" variant="outline" icon={<IconPin />}>
                  Pinned
                </Badge>
              )}
            </h3>
            <span className="text-sm text-fg-secondary">{stepCondition(policy, step)}</span>
            {errs.map((e) => (
              <span key={e} className="flex items-center gap-1.5 text-xs text-fg-danger">
                <IconCircleAlert size="sm" aria-hidden />
                {e}
              </span>
            ))}
          </div>
          {!pinned && (
            <div className="flex items-center gap-0.5">
              <IconButton icon={<IconPencil />} label={`Edit ${label}`} onClick={() => onEdit(index)} />
              <IconButton
                icon={<IconTrash2 />}
                tone="danger"
                label={`Delete ${label}`}
                onClick={() => onDelete(index)}
              />
            </div>
          )}
        </div>
        <dl className="m-0 grid grid-cols-[calc(var(--spacing)*22)_minmax(0,1fr)] items-center gap-x-4 gap-y-2.5">
          <dt className="font-mono text-xs text-fg-tertiary">NOTIFY</dt>
          <dd className="m-0 flex flex-wrap gap-2">
            {targetLabels(step).map((t) => (
              <Tag key={t} icon={<IconUser />}>
                {t}
              </Tag>
            ))}
          </dd>
          <dt className="font-mono text-xs text-fg-tertiary">CHANNELS</dt>
          <dd className="m-0 flex flex-wrap gap-2">
            {CHANNEL_ORDER.filter((c) => step.channels.includes(c)).map((c) => (
              <Badge
                key={c}
                tone={c === 'voice' ? 'warning' : 'neutral'}
                variant="outline"
                icon={CHANNEL[c].icon}
              >
                {CHANNEL[c].label}
              </Badge>
            ))}
            {!step.channels.length && (
              <Badge tone="danger" variant="outline" icon={<IconCircleAlert />}>
                No channel · notifies nobody
              </Badge>
            )}
          </dd>
        </dl>
        {note && <p className="m-0 border-t border-border-subtle pt-2.5 text-xs text-fg-secondary">{note}</p>}
      </div>
    </li>
  );
}
