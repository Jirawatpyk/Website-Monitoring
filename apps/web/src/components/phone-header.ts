/**
 * Below lg the phone top bar carries the page's title and a back arrow (spec §22.1, D-045). Most pages pass
 * AURA's `PageHeader titleHideBelow="lg"` (5.41, request 20): the title is visually hidden (still the h1),
 * the breadcrumb and eyebrow go. These classes cover the cases it doesn't — rules in `app/globals.css`
 * (Tailwind's arbitrary variants can't name AURA's `__` class names).
 */
export const phoneHeader = {
  /** The breadcrumb only: the incident page keeps its title in the body (MIncident). */
  crumb: 'dxt-phone-crumb',
  /** The title only: Maintenance keeps its day line, the phone eyebrow (MMaintenanceList). */
  title: 'dxt-phone-title',
  /** The actions box, when everything in it is in the top bar below lg (Site detail for a Viewer). */
  noActions: 'dxt-phone-no-actions',
} as const;
