import type { Metadata } from 'next';
import { Container } from '@jirawatpyk/aura-react';

export const metadata: Metadata = { title: 'Overview' };

/** Overview dashboard — board `Main` (docs/design/screens.md). Not built yet: run /implement-screen Main. */
export default function OverviewPage() {
  return (
    <Container>
      <div className="flex flex-col gap-1 py-8">
        <span className="font-mono text-xs text-fg-secondary">OVERVIEW</span>
        <h1 className="m-0 font-display text-4xl font-semibold">Overview</h1>
      </div>
    </Container>
  );
}
