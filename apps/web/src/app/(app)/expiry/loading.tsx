import { Container, Skeleton } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

/**
 * While `/expiry` loads, the page's own shapes (§39.6): the KPIs 2 + 1 on a phone and 3 from md,
 * the note, the Show control, then cards below xl and the table from xl.
 */
export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading SSL and domains">
        <PageHeaderSkeleton actions={1} phoneBar="title" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4" aria-hidden>
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
          <div className="max-md:col-span-2">
            <CardSkeleton lines={2} />
          </div>
        </div>
        <CardSkeleton lines={1} />
        <div className="xl:hidden" aria-hidden>
          <Skeleton variant="rect" height={44} />
        </div>
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:hidden" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <CardSkeleton key={i} lines={2} />
          ))}
        </div>
        <div className="max-xl:hidden">
          <CardSkeleton lines={10} />
        </div>
      </PageSkeleton>
    </Container>
  );
}
