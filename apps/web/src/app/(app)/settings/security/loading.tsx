import { Container, Skeleton } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

/** While `/settings/security` loads: the header, the tabs, who can sign in, the people, the two cards. */
export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading sign-in and security">
        <PageHeaderSkeleton phoneBar="title" />
        {/* The section tabs, then (below md) the view-only line. */}
        <Skeleton variant="rect" width="100%" height={44} />
        <div className="md:hidden">
          <Skeleton variant="rect" width="100%" height={44} />
        </div>
        <div className="md:max-w-xl">
          <CardSkeleton lines={3} />
        </div>
        <CardSkeleton lines={8} />
        <div className="grid gap-6 md:grid-cols-2 md:gap-4">
          <CardSkeleton lines={5} />
          <CardSkeleton lines={3} />
        </div>
      </PageSkeleton>
    </Container>
  );
}
