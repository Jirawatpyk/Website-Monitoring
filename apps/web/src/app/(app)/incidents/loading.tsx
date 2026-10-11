import { Container, Skeleton } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

/** While `/incidents` loads: the header, the KPI row and the table (S07). */
export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading incidents">
        <PageHeaderSkeleton actions={1} actionsFromMd />
        <div className="hidden grid-cols-2 gap-4 md:grid lg:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, n) => (
            <CardSkeleton key={n} lines={2} />
          ))}
        </div>
        <div className="flex flex-col gap-6 max-md:hidden">
          <CardSkeleton lines={1} />
          <CardSkeleton lines={8} />
        </div>
        <div className="flex flex-col gap-4 md:hidden" aria-hidden>
          <Skeleton variant="rect" height={44} width="100%" />
          <Skeleton variant="text" width="55%" />
          <CardSkeleton lines={3} />
          <CardSkeleton lines={3} />
          <CardSkeleton lines={3} />
        </div>
      </PageSkeleton>
    </Container>
  );
}
