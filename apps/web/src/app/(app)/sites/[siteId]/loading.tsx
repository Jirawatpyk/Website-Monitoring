import { Container, Skeleton } from '@jirawatpyk/aura-react';
import { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from '@/components/states';

/**
 * While Site detail loads, in the page's own shape: desktop — info strip, four stats, chart + latest
 * round, tables; phone (MSite) — the range control, three small stats, a short chart, two cards.
 */
export default function Loading() {
  return (
    <Container>
      <PageSkeleton label="Loading site">
        {/* Desktop: Mute, Maintenance, Edit monitors on the right; phones draw them as rows below. */}
        <PageHeaderSkeleton breadcrumb actions={3} actionsFromMd phoneBar="all" />
        <div className="flex flex-col gap-6 max-md:hidden">
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
          {/* the Page fingerprint card (S09d) */}
          <CardSkeleton lines={2} />
        </div>
        <div className="flex flex-col gap-6 md:hidden">
          {/* the header's phone rows: Mute / Maintenance, then Edit monitors full width */}
          <div className="grid grid-cols-2 gap-3">
            <Skeleton variant="rect" height={44} width="100%" />
            <Skeleton variant="rect" height={44} width="100%" />
          </div>
          <Skeleton variant="rect" height={44} width="100%" />
          {/* the 24 h / 7 d / 30 d / 90 d range control */}
          <Skeleton variant="rect" height={44} width="100%" />
          <div className="grid grid-cols-3 gap-2">
            <Skeleton variant="rect" height={64} width="100%" />
            <Skeleton variant="rect" height={64} width="100%" />
            <Skeleton variant="rect" height={64} width="100%" />
          </div>
          <CardSkeleton lines={3} />
          <CardSkeleton lines={2} />
          <CardSkeleton lines={4} />
          <CardSkeleton lines={2} />
        </div>
      </PageSkeleton>
    </Container>
  );
}
