import { Container, Skeleton } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

/**
 * While `/reports` loads, the page's own shapes (MReports, §42 item 10): the header (the month switch
 * under it on a phone), the stats 2 + 1 on a phone and 3 from md, then skeleton cards below xl (two per
 * row from md) and the table from xl.
 */
export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading uptime reports">
        <PageHeaderSkeleton actions={1} actionFullOnPhone phoneBar="title" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4" aria-hidden>
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
          <div className="max-md:col-span-2">
            <CardSkeleton lines={2} />
          </div>
        </div>
        <div className="flex flex-col gap-3" aria-hidden>
          <Skeleton variant="text" width="40%" />
          <Skeleton variant="rect" height={44} />
        </div>
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:hidden" aria-hidden>
          {Array.from({ length: 4 }, (_, i) => (
            <CardSkeleton key={i} lines={3} />
          ))}
        </div>
        <div className="max-xl:hidden">
          <CardSkeleton lines={10} />
        </div>
      </PageSkeleton>
    </Container>
  );
}
