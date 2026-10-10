import { Container } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

/** While the incident loads: the header, the facts strip, then the evidence / timeline and Resolve cards. */
export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading incident">
        <PageHeaderSkeleton breadcrumb actions={3} />
        <div className="hidden md:block">
          <CardSkeleton lines={2} />
        </div>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_calc(var(--spacing)*88)]">
          <div className="flex min-w-0 flex-col gap-6">
            {/* Evidence by location (table + the screenshot preview), then the Timeline */}
            <CardSkeleton lines={7} />
            <CardSkeleton lines={5} />
          </div>
          <CardSkeleton lines={4} />
        </div>
      </PageSkeleton>
    </Container>
  );
}
