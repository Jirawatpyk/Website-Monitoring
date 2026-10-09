import { Container } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

/** While Site detail loads: breadcrumb header, info strip, the four stats, chart + latest round, tables. */
export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading site">
        <PageHeaderSkeleton breadcrumb actions={1} />
        <CardSkeleton fields={5} columns={3} />
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <CardSkeleton lines={6} />
          </div>
          <CardSkeleton lines={5} />
        </div>
        <CardSkeleton lines={4} />
      </PageSkeleton>
    </Container>
  );
}
