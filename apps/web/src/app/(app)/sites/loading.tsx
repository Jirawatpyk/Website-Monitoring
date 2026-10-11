import { Container } from '@jirawatpyk/aura-react';
import { PageHeaderSkeleton, PageSkeleton } from '@/components/states';
import { SitesListSkeleton } from '@/features/sites';

/** While `/sites` loads: the page header, then the Sites list's own shape (S05c). */
export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading sites">
        <PageHeaderSkeleton actions={1} actionFullOnPhone />
        <SitesListSkeleton />
      </PageSkeleton>
    </Container>
  );
}
