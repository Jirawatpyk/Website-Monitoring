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

interface NavEntry {
  id: string;
  label: string;
  icon: ReactElement;
  href: string;
  /** Slice in docs/implementation-plan.md that builds the page behind the link. */
  slice: string;
  /**
   * Shown only when its page exists — a link to an unbuilt page is a dead control (spec §14.16).
   * The slice that builds the page flips this to `true` as part of its Definition of Done.
   */
  live: boolean;
}

/** Main navigation, as drawn on every desktop board (e.g. docs/design/canvas/AuditLog.dc.html). */
const SECTIONS: { title?: string; items: NavEntry[] }[] = [
  {
    items: [
      {
        id: 'overview',
        label: 'Overview',
        icon: <IconLayoutDashboard />,
        href: '/',
        slice: 'S06',
        // The landing page: live from S01 as a placeholder, real dashboard in S06.
        live: true,
      },
      {
        id: 'incidents',
        label: 'Incidents',
        icon: <IconBell />,
        href: '/incidents',
        slice: 'S07',
        live: false,
      },
      { id: 'sites', label: 'Sites', icon: <IconMonitor />, href: '/sites', slice: 'S05', live: false },
      {
        id: 'expiry',
        label: 'SSL & domains',
        icon: <IconLock />,
        href: '/expiry',
        slice: 'S13',
        live: false,
      },
    ],
  },
  {
    title: 'Operations',
    items: [
      { id: 'oncall', label: 'On-call', icon: <IconUsers />, href: '/oncall', slice: 'S10', live: false },
      {
        id: 'maintenance',
        label: 'Maintenance',
        icon: <IconCalendar />,
        href: '/maintenance',
        slice: 'S09',
        live: false,
      },
      {
        id: 'escalation',
        label: 'Escalation policies',
        icon: <IconArrowUpRight />,
        href: '/escalation',
        slice: 'S08',
        live: false,
      },
    ],
  },
  {
    title: 'Reports',
    items: [
      {
        id: 'uptime',
        label: 'Uptime reports',
        icon: <IconChartColumn />,
        href: '/reports',
        slice: 'S20',
        live: false,
      },
      { id: 'audit', label: 'Audit log', icon: <IconFileText />, href: '/audit', slice: 'S15', live: false },
    ],
  },
  {
    title: 'System',
    items: [
      {
        id: 'probes',
        label: 'Probes & heartbeat',
        icon: <IconServer />,
        href: '/probes',
        slice: 'S12',
        live: false,
      },
      {
        id: 'settings',
        label: 'Settings',
        icon: <IconSettings />,
        href: '/settings/users',
        slice: 'S16',
        live: false,
      },
      { id: 'guide', label: 'User guide', icon: <IconInfo />, href: '/guide', slice: 'S18', live: false },
    ],
  },
];

export const NAV_SECTIONS: NavSections = SECTIONS.map(({ title, items }) => ({
  title,
  items: items.filter((item) => item.live).map(({ id, label, icon, href }) => ({ id, label, icon, href })),
})).filter((section) => section.items.length > 0);
