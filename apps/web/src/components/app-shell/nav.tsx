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
        slice: 'S06b',
        // The landing page: live from S01 as a placeholder, the real dashboard since S06b.
        live: true,
      },
      {
        id: 'incidents',
        label: 'Incidents',
        icon: <IconBell />,
        href: '/incidents',
        slice: 'S07',
        live: true,
      },
      { id: 'sites', label: 'Sites', icon: <IconMonitor />, href: '/sites', slice: 'S05', live: true },
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

/**
 * Counts beside nav items (spec §20, §21.2): Sites = monitored sites, drafts left out; Incidents = open
 * incidents (any state before Resolved, Incidents board).
 */
export interface NavCounts {
  sites?: number;
  incidents?: number;
}

/** The sections with their counts filled in; a count of 0 isn't shown. */
export function navSectionsWithCounts(counts: NavCounts): NavSections {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.map((item) =>
      item.id === 'sites' && counts.sites
        ? { ...item, count: counts.sites }
        : item.id === 'incidents' && counts.incidents
          ? { ...item, count: counts.incidents }
          : item,
    ),
  }));
}

/** The phone boards' four sections, in their order (D-018, D-031): Overview, Incidents, Sites, On-call. */
const PHONE_SECTIONS = ['overview', 'incidents', 'sites', 'oncall'] as const;

/**
 * BottomNav items below lg: the phone sections whose pages exist (D-032 — Incidents joins with S07,
 * On-call with S10). AURA needs 2 to 5.
 */
export const BOTTOM_NAV_ITEMS = PHONE_SECTIONS.flatMap((id) => {
  const entry = SECTIONS.flatMap((section) => section.items).find((item) => item.id === id);
  return entry?.live ? [{ id: entry.id, label: entry.label, icon: entry.icon, href: entry.href }] : [];
});

/** The BottomNav items with the open-incident count on Incidents (MIncidents, MOverview; 0 isn't shown). */
export function bottomNavWithCounts(counts: NavCounts) {
  return BOTTOM_NAV_ITEMS.map((item) =>
    item.id === 'incidents' && counts.incidents ? { ...item, count: counts.incidents } : item,
  );
}

/**
 * The nav item for the current path (SideNav `value`): exact match or a sub-page, longest href wins;
 * `/` only matches itself. Null when no shown item owns the page.
 */
export function activeNavId(pathname: string): string | null {
  const items = NAV_SECTIONS.flatMap((section) => section.items);
  const matches = items.filter(({ href }) =>
    href === '/' ? pathname === '/' : !!href && (pathname === href || pathname.startsWith(`${href}/`)),
  );
  matches.sort((a, b) => (b.href?.length ?? 0) - (a.href?.length ?? 0));
  return matches[0]?.id ?? null;
}
