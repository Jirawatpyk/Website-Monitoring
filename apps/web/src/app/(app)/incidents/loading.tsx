import { Container } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

/** While `/incidents` loads: the header, the KPI row and the table (S07). */
export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading incidents">
        <PageHeaderSkeleton />
        <div className="hidden grid-cols-2 gap-4 md:grid lg:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, n) => (
            <CardSkeleton key={n} lines={2} />
          ))}
        </div>
        <CardSkeleton lines={8} />
      </PageSkeleton>
    </Container>
  );
}
