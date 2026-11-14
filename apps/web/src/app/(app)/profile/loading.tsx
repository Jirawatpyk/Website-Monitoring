import { Container } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

/** While `/profile` loads: the header, then the two columns of cards (one column on a phone). */
export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading your profile">
        <PageHeaderSkeleton actions={1} phoneBar="title" />
        <div className="grid items-start gap-6 md:grid-cols-[3fr_2fr]">
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
      </PageSkeleton>
    </Container>
  );
}
