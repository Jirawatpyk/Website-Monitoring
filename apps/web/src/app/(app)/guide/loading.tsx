import { Container } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

/** While `/guide` loads: the search and chips, the topic list beside the article (one column below lg). */
export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading the user guide">
        <PageHeaderSkeleton phoneBar="title" />
        <CardSkeleton lines={1} />
        <div
          className="grid grid-cols-1 gap-6 lg:grid-cols-[calc(var(--spacing)*75)_minmax(0,1fr)]"
          aria-hidden
        >
          <CardSkeleton lines={8} />
          <div className="max-lg:hidden">
            <CardSkeleton lines={12} />
          </div>
        </div>
      </PageSkeleton>
    </Container>
  );
}
