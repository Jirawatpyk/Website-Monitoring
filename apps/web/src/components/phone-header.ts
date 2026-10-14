/**
 * Below lg the phone top bar carries the page's title and a back arrow (spec §22.1, D-045), so a page's
 * `PageHeader` drops what the bar repeats. Pass the parts that apply as `className` (joined): the title
 * stays the page's h1 for screen readers (visually hidden), the breadcrumb and a section eyebrow go. The
 * rules are in `app/globals.css` (Tailwind's arbitrary variants can't name AURA's `__` class names).
 * Overview keeps its own phone title and eyebrow (MOverview4); the incident page keeps its title (MIncident).
 * Until AURA's `PageHeader` hides these by width itself (request 20).
 */
export const phoneHeader = {
  crumb: 'dxt-phone-crumb',
  eyebrow: 'dxt-phone-eyebrow',
  title: 'dxt-phone-title',
  /** The actions box, when everything in it is in the top bar below lg (Site detail for a Viewer). */
  noActions: 'dxt-phone-no-actions',
} as const;

/** The parts the bar repeats on a list or detail page: breadcrumb, section eyebrow and title. */
export const PHONE_BAR_HEADER = `${phoneHeader.crumb} ${phoneHeader.eyebrow} ${phoneHeader.title}`;
