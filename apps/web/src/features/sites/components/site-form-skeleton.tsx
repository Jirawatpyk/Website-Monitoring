import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

/**
 * While Add site / Edit site loads: the SiteForm grid — Site, Tier, Ownership left; checklist and test
 * right. Edit site has one header button (Visit site), Add site none.
 */
export function SiteFormSkeleton({ label, actions = 0 }: { label: string; actions?: number }) {
  return (
    <PageSkeleton label={label}>
      <PageHeaderSkeleton breadcrumb actions={actions} />
      {/* Same grid as SiteForm, so the cards land where the form's will. */}
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <CardSkeleton fields={5} columns={2} />
          <CardSkeleton lines={3} />
          <CardSkeleton fields={3} columns={3} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
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
      {/* Same split as MonitorsEditor: a fixed-width list beside the editor from lg up. */}
      <div className="flex flex-col items-start gap-6 lg:flex-row">
        <div className="flex w-full shrink-0 flex-col gap-3 lg:w-85">
          <CardSkeleton lines={4} />
        </div>
        <div className="flex w-full min-w-0 flex-col gap-4">
          <CardSkeleton fields={4} columns={2} />
          <CardSkeleton fields={2} columns={2} />
        </div>
      </div>
    </PageSkeleton>
  );
}
