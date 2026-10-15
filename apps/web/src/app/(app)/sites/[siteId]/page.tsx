import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Container } from '@jirawatpyk/aura-react';
import { SiteDetailView, rangeOf } from '@/features/sites';
import { getSiteDetail, getSiteName } from '@/features/sites/server';
import { getAccess } from '@/lib/auth/session';
import { PageFingerprintCard } from '@/features/page-change';
import { getSitePageChange } from '@/features/page-change/server';

/** The tab reads the site's name ("Test target · DxT Monitor"). */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ siteId: string }>;
}): Promise<Metadata> {
  const name = await getSiteName((await params).siteId);
  return { title: name ?? 'Site not found' };
}

// Maintenance actions send their messages after the 10 s Undo window (`after()`, §24.8): room for that.
export const maxDuration = 60;

/** `/sites/[siteId]` — Site detail (spec §20, boards SiteDetail and MSite). */
export default async function SiteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const [{ siteId }, query] = await Promise.all([params, searchParams]);
  const range = rangeOf(query.range);
  const now = new Date();
  const [detail, access, page] = await Promise.all([
    getSiteDetail(siteId, range, now),
    getAccess(),
    getSitePageChange(siteId, now),
  ]);
  if (!detail) notFound();
  const active = access.status === 'active' ? access : null;
  return (
    <Container>
      <SiteDetailView
        detail={detail}
        range={range}
        role={active?.profile.role ?? null}
        meId={active?.profile.id ?? ''}
        viewer={{ name: active?.profile.displayName ?? '', email: active?.profile.email ?? '' }}
        nowIso={now.toISOString()}
        pageFingerprint={
          page ? (
            <PageFingerprintCard
              view={page.view}
              siteName={detail.name}
              canAccept={page.canAccept}
              viewerName={active?.profile.displayName ?? ''}
            />
          ) : null
        }
      />
    </Container>
  );
}
