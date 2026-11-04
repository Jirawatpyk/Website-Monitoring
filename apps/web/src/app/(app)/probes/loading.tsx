import { Container } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

/** While `/probes` loads: the summary, the three probe cards, the heartbeats table, the three cards. */
export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading probes and heartbeat">
        <PageHeaderSkeleton actions={1} phoneBar="title" />
        <CardSkeleton lines={1} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3" aria-hidden>
          <CardSkeleton lines={4} />
          <div className="max-lg:hidden">
            <CardSkeleton lines={4} />
          </div>
          <div className="max-lg:hidden">
            <CardSkeleton lines={4} />
          </div>
        </div>
        <CardSkeleton lines={8} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3" aria-hidden>
          <CardSkeleton lines={3} />
          <CardSkeleton lines={3} />
          <CardSkeleton lines={3} />
        </div>
      </PageSkeleton>
    </Container>
  );
}
