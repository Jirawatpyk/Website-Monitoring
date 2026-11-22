import { Container } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

/** While `/reports` loads, the page's own shapes: the header with the month control, 3 stats, the table. */
export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading uptime reports">
        <PageHeaderSkeleton actions={1} phoneBar="title" />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4" aria-hidden>
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
        </div>
        <CardSkeleton lines={10} />
      </PageSkeleton>
    </Container>
  );
}
