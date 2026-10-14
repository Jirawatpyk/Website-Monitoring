import { BOTTOM_NAV_ITEMS } from './nav';

export interface PhoneBarBack {
  href: string;
  label: string;
}

/** What the phone top bar shows for a page (spec §22.1, D-045): its title, or the brand; a back arrow off the tabs. */
export interface PhoneBarSpec {
  /** Null → the brand (Overview, MOverview4). */
  title: string | null;
  back?: PhoneBarBack;
}

const TO_OVERVIEW: PhoneBarBack = { href: '/', label: 'Back to overview' };
const TO_SITES: PhoneBarBack = { href: '/sites', label: 'Back to sites' };
const TO_INCIDENTS: PhoneBarBack = { href: '/incidents', label: 'Back to incidents' };

/** Back from a site's sub-page to the Site detail page that opened it (Edit site, Edit monitors). */
export const toSite = (siteId: string): PhoneBarBack => ({ href: `/sites/${siteId}`, label: 'Back to site' });

/**
 * The bar for a path whose title needs no data. Site detail and Incident name their own (the site, the
 * INC number); this gives their fallback when the record isn't readable. A bottom-nav tab has no back arrow.
 */
export function phoneBarFor(pathname: string): PhoneBarSpec {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return { title: null };
  const tab = BOTTOM_NAV_ITEMS.find((item) => item.href === path);
  if (tab) return { title: tab.label };
  const [first, id, sub] = path.split('/').slice(1);
  if (first === 'sites') {
    if (id === 'new') return { title: 'Add site', back: TO_SITES };
    if (id && sub === 'edit') return { title: 'Edit site', back: toSite(id) };
    if (id && sub === 'monitors') return { title: 'Edit monitors', back: toSite(id) };
    if (id) return { title: 'Site', back: TO_SITES };
  }
  if (first === 'incidents' && id) return { title: 'Incident', back: TO_INCIDENTS };
  if (path === '/maintenance') return { title: 'Maintenance', back: TO_OVERVIEW };
  if (path === '/escalation') return { title: 'Escalation', back: TO_OVERVIEW };
  return { title: null };
}
