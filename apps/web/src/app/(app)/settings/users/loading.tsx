import { Container, Skeleton } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

/** While `/settings/users` loads: the header with Add person, the tabs, the banner, the people table, the role matrix. */
export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading users and roles">
        <PageHeaderSkeleton actions={1} phoneBar="title" />
        {/* The section tabs, then (below md) the view-only line. */}
        <Skeleton variant="rect" width="100%" height={44} />
        <div className="md:hidden">
          <Skeleton variant="rect" width="100%" height={44} />
        </div>
        <CardSkeleton lines={1} />
        <CardSkeleton lines={8} />
        <CardSkeleton lines={10} />
      </PageSkeleton>
    </Container>
  );
}
