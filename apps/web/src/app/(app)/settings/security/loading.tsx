import { Container } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

/** While `/settings/security` loads: the header and tabs, who can sign in, the people, the two cards. */
export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading sign-in and security">
        <PageHeaderSkeleton phoneBar="title" />
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
