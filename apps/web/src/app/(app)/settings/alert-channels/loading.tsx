import { Container, Skeleton } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

/** While `/settings/alert-channels` loads: the header, the tabs, four channel cards, routing, three cards, the log. */
export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading alert channels">
        <PageHeaderSkeleton phoneBar="title" />
        {/* Below md the Settings select has a visible label above its 44 px field. */}
        <div className="md:hidden">
          <Skeleton variant="text" width="30%" />
        </div>
        <Skeleton variant="rect" width="100%" height={44} />
        <div className="md:hidden">
          <Skeleton variant="rect" width="100%" height={44} />
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <CardSkeleton lines={5} />
          <CardSkeleton lines={5} />
          <CardSkeleton lines={5} />
          <CardSkeleton lines={5} />
        </div>
        <CardSkeleton lines={6} />
        <div className="grid gap-4 md:grid-cols-3">
          <CardSkeleton lines={3} />
          <CardSkeleton lines={3} />
          <CardSkeleton lines={3} />
        </div>
        <CardSkeleton lines={8} />
      </PageSkeleton>
    </Container>
  );
}
