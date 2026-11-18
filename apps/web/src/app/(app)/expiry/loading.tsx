import { Container } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

/** While `/expiry` loads: the header, the three KPIs, the note and the table. */
export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading SSL and domains">
        <PageHeaderSkeleton actions={1} phoneBar="title" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3" aria-hidden>
          <CardSkeleton lines={2} />
          <div className="max-md:hidden">
            <CardSkeleton lines={2} />
          </div>
          <div className="max-md:hidden">
            <CardSkeleton lines={2} />
          </div>
        </div>
        <CardSkeleton lines={2} />
        <CardSkeleton lines={10} />
      </PageSkeleton>
    </Container>
  );
}
