import { Container, Skeleton } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

/** While `/settings/organisation` loads: the header, the tabs, the tier cards, the hours, clients, two cards. */
export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading organisation settings">
        <PageHeaderSkeleton phoneBar="title" />
        <Skeleton variant="rect" width="100%" height={44} />
        <div className="md:hidden">
          <Skeleton variant="rect" width="100%" height={44} />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <CardSkeleton lines={5} />
          <CardSkeleton lines={5} />
          <CardSkeleton lines={5} />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
        </div>
        <CardSkeleton lines={8} />
        <div className="grid gap-4 md:grid-cols-2">
          <CardSkeleton lines={5} />
          <CardSkeleton lines={5} />
        </div>
      </PageSkeleton>
    </Container>
  );
}
