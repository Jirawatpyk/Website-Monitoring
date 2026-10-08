/**
 * Page grids shared by the Sites forms and their loading skeletons, so a skeleton can't drift from the
 * page it stands in for.
 */

/** SiteForm (Add site / Edit site): Site, Tier, Ownership left; checklist, test, bot protection right. */
export const SITE_FORM_GRID =
  'grid grid-cols-1 items-start gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:grid-cols-3';
export const SITE_FORM_MAIN = 'flex min-w-0 flex-col gap-4 lg:col-span-2';
export const SITE_FORM_SIDE = 'flex min-w-0 flex-col gap-4';

/** MonitorsEditor: the monitor list beside the editor card from lg up. */
export const EDITOR_SPLIT = 'flex flex-col items-start gap-6 lg:flex-row';
export const EDITOR_LIST = 'flex w-full shrink-0 flex-col gap-3 lg:w-85';
export const EDITOR_PANE = 'flex w-full min-w-0 grow flex-col gap-4';
