import type { ComponentProps, ReactElement } from 'react';
import type { SideNav } from '@jirawatpyk/aura-react';
import {
  IconArrowUpRight,
  IconBell,
  IconCalendar,
  IconChartColumn,
  IconFileText,
  IconInfo,
  IconLayoutDashboard,
  IconLock,
  IconMonitor,
  IconServer,
  IconSettings,
  IconUsers,
} from '@jirawatpyk/aura-react/icons';

type NavSections = NonNullable<ComponentProps<typeof SideNav>['sections']>;
type Phase = 'P0' | 'P1' | 'P2';

interface NavEntry {
  id: string;
  label: string;
  icon: ReactElement;
  href: string;
  /** PRD §6 priority of the screen behind the link (docs/design/screens.md). */
  phase: Phase;
}

/**
 * Phases whose screens exist. A link to an unbuilt page would be a dead control (spec §14.16), so
 * add a phase here only when its routes are live.
 */
const ENABLED_PHASES: ReadonlySet<Phase> = new Set(['P0']);

/** Main navigation, as drawn on every desktop board (e.g. docs/design/canvas/AuditLog.dc.html). */
const SECTIONS: { title?: string; items: NavEntry[] }[] = [
  {
    items: [
      { id: 'overview', label: 'Overview', icon: <IconLayoutDashboard />, href: '/', phase: 'P0' },
      { id: 'incidents', label: 'Incidents', icon: <IconBell />, href: '/incidents', phase: 'P0' },
      { id: 'sites', label: 'Sites', icon: <IconMonitor />, href: '/sites', phase: 'P0' },
      { id: 'expiry', label: 'SSL & domains', icon: <IconLock />, href: '/expiry', phase: 'P1' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { id: 'oncall', label: 'On-call', icon: <IconUsers />, href: '/oncall', phase: 'P1' },
      { id: 'maintenance', label: 'Maintenance', icon: <IconCalendar />, href: '/maintenance', phase: 'P0' },
      {
        id: 'escalation',
        label: 'Escalation policies',
        icon: <IconArrowUpRight />,
        href: '/escalation',
        phase: 'P0',
      },
    ],
  },
  {
    title: 'Reports',
    items: [
      { id: 'uptime', label: 'Uptime reports', icon: <IconChartColumn />, href: '/reports', phase: 'P2' },
      { id: 'audit', label: 'Audit log', icon: <IconFileText />, href: '/audit', phase: 'P1' },
    ],
  },
  {
    title: 'System',
    items: [
      { id: 'probes', label: 'Probes & heartbeat', icon: <IconServer />, href: '/probes', phase: 'P1' },
      { id: 'settings', label: 'Settings', icon: <IconSettings />, href: '/settings/users', phase: 'P0' },
      { id: 'guide', label: 'User guide', icon: <IconInfo />, href: '/guide', phase: 'P1' },
    ],
  },
];

export const NAV_SECTIONS: NavSections = SECTIONS.map(({ title, items }) => ({
  title,
  items: items
    .filter((item) => ENABLED_PHASES.has(item.phase))
    .map(({ id, label, icon, href }) => ({ id, label, icon, href })),
})).filter((section) => section.items.length > 0);
