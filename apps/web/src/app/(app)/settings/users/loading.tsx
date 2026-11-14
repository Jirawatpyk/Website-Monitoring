import { Container } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

/** While `/settings/users` loads: the header with Add person, the tabs, the banner, the people table, the role matrix. */
export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading users and roles">
        <PageHeaderSkeleton actions={1} phoneBar="title" />
        <CardSkeleton lines={1} />
        <CardSkeleton lines={2} />
        <CardSkeleton lines={8} />
        <CardSkeleton lines={10} />
      </PageSkeleton>
    </Container>
  );
}
