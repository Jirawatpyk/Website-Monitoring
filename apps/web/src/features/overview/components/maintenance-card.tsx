import type { ReactElement } from 'react';
import { Card } from '@jirawatpyk/aura-react';
import {
  IconArrowRight,
  IconCalendar,
  IconChevronRight,
  IconClock,
  IconEyeOff,
} from '@jirawatpyk/aura-react/icons';
import Link from 'next/link';
import type { OverviewMaintenanceCard } from '../types';

const FOCUS =
  'rounded-aura-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring';

/**
 * Overview "Maintenance & mutes" (Main3 "+ Maint.", spec §23.8): what is deliberately quiet right now.
 * No buttons — every line opens Maintenance & mutes. Left out when nothing is active, waiting or scheduled.
 */
export function MaintenanceCard({ card }: { card: OverviewMaintenanceCard }) {
  const links = [
    card.waiting > 0 && { icon: <IconClock size="sm" />, text: `${card.waiting} waiting for approval` },
    card.scheduled > 0 && {
      icon: <IconCalendar size="sm" />,
      text: `${card.scheduled} scheduled${card.nextScheduled ? ` · next ${card.nextScheduled}` : ''}`,
    },
  ].filter((x): x is { icon: ReactElement; text: string } => !!x);
  return (
    <Card
      title="Maintenance & mutes"
      description="Alerts off or muted, checks still run"
      headingLevel={3}
      actions={
        <Link href="/maintenance" className={`flex items-center gap-1 text-sm whitespace-nowrap ${FOCUS}`}>
          Open
          <IconArrowRight size="sm" />
        </Link>
      }
    >
      <div className="flex flex-col gap-3">
        {card.active.map((m) => (
          <Link
            key={m.id}
            href="/maintenance"
            className={`flex items-start gap-2.5 text-sm text-fg-primary no-underline ${FOCUS}`}
          >
            <span className={`flex pt-0.5 ${m.kind === 'mute' ? 'text-fg-secondary' : 'text-fg-accent'}`}>
              {m.kind === 'mute' ? <IconEyeOff size="sm" /> : <IconCalendar size="sm" />}
            </span>
            <span className="flex min-w-0 grow flex-col">
              <span className="font-medium">{m.title}</span>
              <span className="text-fg-secondary">{m.detail}</span>
            </span>
          </Link>
        ))}
        {card.active.length === 0 && (
          <span className="text-sm text-fg-secondary">Nothing active right now.</span>
        )}
        {links.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-border-subtle pt-2.5 text-sm">
            {links.map((l) => (
              <Link
                key={l.text}
                href="/maintenance"
                className={`flex min-h-8 items-center gap-2 text-fg-primary no-underline ${FOCUS}`}
              >
                <span className="flex text-fg-secondary">{l.icon}</span>
                <span className="grow">{l.text}</span>
                <span className="flex text-fg-tertiary">
                  <IconChevronRight size="sm" />
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

/** The phone Overview's "Maintenance & mutes" row under "All N sites" (MOverview4, §23.8). */
export function PhoneMaintenance({ line }: { line: string }) {
  return (
    <Link
      href="/maintenance"
      className={`flex min-h-12 items-center gap-3 rounded-aura-lg border border-border-default bg-bg-surface px-aura-4 text-fg-primary no-underline hover:bg-bg-surface-hover ${FOCUS}`}
    >
      <span className="flex text-fg-secondary">
        <IconCalendar />
      </span>
      <span className="flex grow flex-col py-1.5 leading-tight">
        <span className="text-sm font-medium">Maintenance &amp; mutes</span>
        <span className="text-xs text-fg-secondary">{line}</span>
      </span>
      <span className="flex text-fg-tertiary">
        <IconChevronRight />
      </span>
    </Link>
  );
}
