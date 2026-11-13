import { Container } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

/** While `/audit` loads: the header with Export, the filter row, the table. */
export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading the audit log">
        <PageHeaderSkeleton actions={1} phoneBar="title" />
        <CardSkeleton lines={1} />
        <CardSkeleton lines={10} />
      </PageSkeleton>
    </Container>
  );
}
