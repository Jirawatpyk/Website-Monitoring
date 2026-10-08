import { Button, EmptyState } from '@jirawatpyk/aura-react';
import {
  IconCircle,
  IconCircleCheck,
  IconCircleDotDashed,
  IconMonitor,
  IconPlus,
} from '@jirawatpyk/aura-react/icons';

/**
 * No sites yet: Empty states panel 1 (spec §20) — three setup steps and "Add first site", which only an
 * Admin sees; everyone else reads who can add sites.
 */
export function SitesEmpty({ isAdmin, chatConnected }: { isAdmin: boolean; chatConnected: boolean }) {
  const steps = [
    chatConnected
      ? {
          icon: <IconCircleCheck />,
          tone: 'text-fg-positive',
          text: 'Connect the Google Chat Space',
          note: 'Done',
        }
      : {
          icon: <IconCircle />,
          tone: 'text-fg-tertiary',
          text: 'Connect the Google Chat Space',
          note: 'Not set up',
        },
    {
      icon: <IconCircleDotDashed />,
      tone: 'text-fg-secondary',
      text: 'Add sites and pick a tier',
      note: 'No sites yet',
    },
    {
      icon: <IconCircle />,
      tone: 'text-fg-tertiary',
      text: 'Give every site an owner and backup',
      note: 'Needed before alerts',
    },
  ];
  return (
    <div className="flex w-full max-w-120 flex-col gap-4 self-center rounded-aura-lg border border-border-default bg-bg-surface p-aura-6">
      <EmptyState
        size="sm"
        icon={<IconMonitor />}
        headingLevel={2}
        title="Nothing is being monitored yet"
        description="Three steps and the first check runs within a minute."
      />
      <ul className="flex flex-col rounded-aura-md border border-border-default">
        {steps.map((s) => (
          <li
            key={s.text}
            className="flex items-center gap-3 border-b border-border-subtle px-3.5 py-3 text-sm last:border-b-0"
          >
            <span className={`flex ${s.tone}`}>{s.icon}</span>
            <span className="grow">{s.text}</span>
            <span className="text-xs text-fg-secondary">{s.note}</span>
          </li>
        ))}
      </ul>
      {isAdmin ? (
        <span className="self-center">
          <Button icon={<IconPlus />} href="/sites/new">
            Add first site
          </Button>
        </span>
      ) : (
        <span className="text-center text-sm text-fg-secondary">Only an Admin can add sites</span>
      )}
    </div>
  );
}
