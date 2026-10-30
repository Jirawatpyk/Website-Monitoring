import { Container, Skeleton } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

/** While `/oncall` loads: the page's own shape — hero beside the phone card, the week, the rotation. */
export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading on-call">
        <PageHeaderSkeleton actions={1} phoneBar="title" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3" aria-hidden>
          <div className="lg:col-span-2">
            <Skeleton variant="rect" height={140} />
          </div>
          <div className="max-lg:hidden">
            <CardSkeleton lines={3} />
          </div>
        </div>
        <div className="max-lg:hidden">
          <CardSkeleton lines={5} />
        </div>
        <CardSkeleton lines={5} />
      </PageSkeleton>
    </Container>
  );
}
