import { Container } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

/** While `/settings/security` loads: the header and tabs, who can sign in, the people, the two cards. */
export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading sign-in and security">
        <PageHeaderSkeleton phoneBar="title" />
        <CardSkeleton lines={3} />
        <CardSkeleton lines={8} />
        <CardSkeleton lines={5} />
      </PageSkeleton>
    </Container>
  );
}
