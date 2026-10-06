import type { Metadata } from 'next';
import { Container } from '@jirawatpyk/aura-react';
import { PageHeader } from '@/components/app-shell/page-header';

export const metadata: Metadata = { title: 'Overview' };

/** Overview dashboard — board `Main` (docs/design/screens.md). Not built yet: run /implement-screen Main. */
export default function OverviewPage() {
  return (
    <Container>
      <PageHeader eyebrow="OVERVIEW" title="Overview" />
    </Container>
  );
}
