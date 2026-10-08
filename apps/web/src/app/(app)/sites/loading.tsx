import { Container } from '@jirawatpyk/aura-react';
import { LoadingList, PageHeaderSkeleton } from '@/components/states';

/** While `/sites` loads: the page header, then grey table rows (status pill + site). */
export default function Loading() {
  return (
    <Container>
      <div className="flex flex-col gap-6">
        <PageHeaderSkeleton actions={1} />
        <LoadingList label="Loading sites" />
      </div>
    </Container>
  );
}
