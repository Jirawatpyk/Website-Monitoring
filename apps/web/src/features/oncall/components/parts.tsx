import { Avatar, Badge } from '@jirawatpyk/aura-react';
import { useEffect, useRef } from 'react';
import {
  IconArrowRight,
  IconArrowUpDown,
  IconBan,
  IconCheck,
  IconCircleCheck,
  IconUser,
  IconClock,
  IconMinus,
  IconTriangleAlert,
} from '@jirawatpyk/aura-react/icons';
import type { BadgeIcon, BadgeView, PersonState, SwapView } from '../model';

const ICONS: Record<BadgeIcon, React.ReactElement> = {
  check: <IconCheck />,
  user: <IconUser />,
  'arrow-right': <IconArrowRight />,
  clock: <IconClock />,
  'arrow-up-down': <IconArrowUpDown />,
  'triangle-alert': <IconTriangleAlert />,
  ban: <IconBan />,
  'circle-check': <IconCircleCheck />,
  minus: <IconMinus />,
};

export function StateBadge({ b }: { b: BadgeView }) {
  return (
    <Badge tone={b.tone} variant={b.variant} icon={ICONS[b.icon]}>
      {b.label}
    </Badge>
  );
}

/** One week of a swap: "You would take · Mon 5 → 12 Oct · Arm’s week now". */
export function WeekBox({ w }: { w: SwapView['left'] }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col rounded-aura-md border border-border-default px-3.5 py-2.5 leading-snug">
      <span className="text-xs text-fg-secondary">{w.label}</span>
      <b className="text-base font-semibold tabular-nums">{w.week}</b>
      <span className="text-xs text-fg-secondary">{w.sub}</span>
    </div>
  );
}

/** Requester · asked · Admin, each with where they stand (side card, phone card). */
export function PeopleList({ people }: { people: PersonState[] }) {
  return (
    <div className="flex flex-col rounded-aura-md border border-border-default">
      {people.map((p, i) => (
        <div
          key={`${p.role}:${p.who}`}
          className={`flex min-h-11 items-center gap-2.5 px-3 py-1.5 text-sm leading-none ${i ? 'border-t border-border-subtle' : ''}`}
        >
          <Avatar name={p.who} size="sm" />
          <span className="grow font-medium">
            {p.who} <span className="font-normal text-fg-secondary">{p.role}</span>
          </span>
          <StateBadge b={p.status} />
        </div>
      ))}
    </div>
  );
}

/** A closed request's status line (or Accepted, for the person asked). */
export function StatusLine({
  line,
  claimFocus,
}: {
  line: NonNullable<SwapView['line']>;
  /**
   * After an action on this request the buttons it came from are gone: the page focuses this line once
   * the refreshed one is in (a hidden twin — desktop or phone — can't take focus, so the visible one does).
   */
  claimFocus?: (el: HTMLElement) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (box.current) claimFocus?.(box.current);
  }, [line.text, claimFocus]);
  const icon = {
    check: <IconCheck size="sm" />,
    'circle-check': <IconCircleCheck size="sm" />,
    ban: <IconBan size="sm" />,
    clock: <IconClock size="sm" />,
  }[line.icon];
  return (
    <div
      ref={box}
      role="status"
      tabIndex={-1}
      className="flex items-start gap-2 rounded-aura-md border border-border-default px-3 py-2.5 leading-snug focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    >
      <span className={`flex pt-0.5 ${line.positive ? 'text-fg-positive' : 'text-fg-secondary'}`}>
        {icon}
      </span>
      <span className="flex flex-col">
        <span className="font-medium">{line.text}</span>
        <span className="text-xs text-fg-secondary">{line.sub}</span>
      </span>
    </div>
  );
}
