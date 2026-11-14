import { Container, Skeleton } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

/**
 * While `/profile` loads: the header (the identity block under the top bar below lg), then the two
 * columns of cards from lg, one column below, and the phone's full-width Sign out.
 */
export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading your profile">
        <PageHeaderSkeleton actions={1} phoneBar="title" />
        <div className="flex items-center gap-3 lg:hidden">
          <Skeleton variant="circle" width={40} height={40} />
          <Skeleton variant="rect" width="40%" height={28} />
        </div>
        <div className="grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
          <div className="flex flex-col gap-6">
            <CardSkeleton lines={4} />
            <CardSkeleton lines={5} />
          </div>
          <div className="flex flex-col gap-6">
            <CardSkeleton lines={4} />
            <CardSkeleton lines={3} />
            <CardSkeleton lines={4} />
          </div>
        </div>
        <div className="lg:hidden">
          <Skeleton variant="rect" width="100%" height={44} />
        </div>
      </PageSkeleton>
    </Container>
  );
}
