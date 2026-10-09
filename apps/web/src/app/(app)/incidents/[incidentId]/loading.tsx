import { Container } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

/** While the incident loads: the header, the facts strip, then the evidence / timeline and Resolve cards. */
export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading incident">
        <PageHeaderSkeleton breadcrumb actions={2} />
        <div className="hidden md:block">
          <CardSkeleton lines={2} />
        </div>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_calc(var(--spacing)*88)]">
          <CardSkeleton lines={6} />
          <CardSkeleton lines={4} />
        </div>
      </PageSkeleton>
    </Container>
  );
}
