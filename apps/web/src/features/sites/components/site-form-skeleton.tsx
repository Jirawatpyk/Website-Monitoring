import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';
import {
  EDITOR_LIST,
  EDITOR_PANE,
  EDITOR_SPLIT,
  SITE_FORM_GRID,
  SITE_FORM_MAIN,
  SITE_FORM_SIDE,
} from './layout';

/**
 * While Add site / Edit site loads: the SiteForm grid — Site, Tier, Ownership left; checklist and test
 * right. Edit site has one header button (Visit site), Add site none.
 */
export function SiteFormSkeleton({ label, actions = 0 }: { label: string; actions?: number }) {
  return (
    <PageSkeleton label={label}>
      <PageHeaderSkeleton breadcrumb actions={actions} />
      <div className={SITE_FORM_GRID}>
        <div className={SITE_FORM_MAIN}>
          {/* Site: two fields a row once the card is @md wide; Ownership: three once @xl (as SiteForm). */}
          <CardSkeleton fields={5} columns={2} />
          <CardSkeleton lines={3} />
          <CardSkeleton fields={3} columns={3} />
        </div>
        <div className={SITE_FORM_SIDE}>
          <CardSkeleton lines={8} />
          <CardSkeleton lines={2} />
        </div>
      </div>
    </PageSkeleton>
  );
}

/** While Edit monitors loads: the monitor list on the left, the editor card on the right. */
export function MonitorsEditorSkeleton() {
  return (
    <PageSkeleton label="Loading monitors">
      <PageHeaderSkeleton breadcrumb actions={2} />
      <div className={EDITOR_SPLIT}>
        <div className={EDITOR_LIST}>
          <CardSkeleton lines={4} />
        </div>
        <div className={EDITOR_PANE}>
          <CardSkeleton fields={4} columns={2} />
          <CardSkeleton fields={2} columns={2} />
        </div>
      </div>
    </PageSkeleton>
  );
}
