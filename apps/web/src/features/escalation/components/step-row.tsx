import { Badge, IconButton, Tag } from '@jirawatpyk/aura-react';
import {
  IconArrowDown,
  IconArrowUp,
  IconBell,
  IconCircleAlert,
  IconInfo,
  IconLock,
  IconMail,
  IconPencil,
  IconPin,
  IconTrash2,
  IconTriangleAlert,
  IconUser,
  IconUsers,
} from '@jirawatpyk/aura-react/icons';
import type { EscalationChannel, EscalationStep } from '@dxt/shared';
import type { ReactElement } from 'react';
import {
  canDelete,
  deleteLabel,
  fyiNote,
  moveLabels,
  stepCondition,
  stepErrors,
  stepNote,
  stepWhen,
  targetLabels,
  type PolicyDraft,
} from '../model';

const CHANNEL: Record<EscalationChannel, { label: string; icon: ReactElement }> = {
  chat: { label: 'Chat @mention', icon: <IconBell /> },
  space: { label: 'Alerts Space', icon: <IconUsers /> },
  email: { label: 'Email', icon: <IconMail /> },
  voice: { label: 'Voice call · configured, off until approved', icon: <IconLock /> },
};
const CHANNEL_ORDER: readonly EscalationChannel[] = ['chat', 'space', 'email', 'voice'];

/**
 * One step of a policy (Escalation board): the level dot, when and on what, its errors, who and which
 * channels, its note and the FYI box; move up / down, pencil and delete (each disabled with the board's
 * reason). L0 is pinned.
 */
export function StepRow({
  policy,
  index,
  admins,
  onEdit,
  onDelete,
  onMove,
}: {
  policy: PolicyDraft;
  index: number;
  /** Every active Admin: the token reads "Admin (Tao)" (D-034). */
  admins: readonly string[];
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  /** Trade places with the step above (-1) or below (+1). */
  onMove: (index: number, by: -1 | 1) => void;
}) {
  const step = policy.steps[index] as EscalationStep;
  const errs = stepErrors(policy.steps, index, policy.key);
  const note = stepNote(policy, step, false, admins);
  const pinned = index === 0;
  const label = `L${index}`;
  const move = moveLabels(policy.steps, index);
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
              {step.fyi && (
                <Badge tone="neutral" variant="outline" icon={<IconInfo />}>
                  FYI after ack · no call
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
              <IconButton
                icon={<IconArrowUp />}
                label={move.up}
                touchHeight
                disabled={!move.canUp}
                onClick={() => onMove(index, -1)}
              />
              <IconButton
                icon={<IconArrowDown />}
                label={move.down}
                touchHeight
                disabled={!move.canDown}
                onClick={() => onMove(index, 1)}
              />
              <IconButton
                icon={<IconPencil />}
                label={`Edit ${label}`}
                touchHeight
                onClick={() => onEdit(index)}
              />
              <IconButton
                icon={<IconTrash2 />}
                touchHeight
                tone="danger"
                label={deleteLabel(step)}
                disabled={!canDelete(step)}
                onClick={() => onDelete(index)}
              />
            </div>
          )}
        </div>
        <dl className="m-0 grid grid-cols-[calc(var(--spacing)*22)_minmax(0,1fr)] items-center gap-x-4 gap-y-2.5">
          <dt className="font-mono text-xs text-fg-tertiary">NOTIFY</dt>
          <dd className="m-0 flex flex-wrap gap-2">
            {targetLabels(step, admins).map((t) => (
              <Tag key={t} icon={<IconUser />}>
                {t}
              </Tag>
            ))}
            {step.targets.includes('admins') && admins.length === 1 && (
              <span className="flex items-center gap-1.5 text-xs text-fg-warning">
                <IconTriangleAlert size="sm" aria-hidden />
                {admins[0]} is the only active Admin
              </span>
            )}
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
            {!step.channels.some((c) => c !== 'voice') && (
              <Badge tone="danger" variant="outline" icon={<IconCircleAlert />}>
                No channel · notifies nobody
              </Badge>
            )}
          </dd>
        </dl>
        {note && <p className="m-0 border-t border-border-subtle pt-2.5 text-xs text-fg-secondary">{note}</p>}
        {step.fyi && (
          <div className="flex gap-2.5 rounded-aura-md bg-bg-canvas px-3 py-2.5 text-xs">
            <IconInfo size="sm" className="mt-0.5 shrink-0 text-fg-secondary" aria-hidden />
            <div className="flex flex-col gap-0.5">
              <b className="font-semibold">After ack: FYI only if still down, no call</b>
              <span className="text-fg-secondary">{fyiNote(step)}</span>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}
