import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Container } from '@jirawatpyk/aura-react';
import { SiteDetailView, rangeOf } from '@/features/sites';
import { getSiteDetail } from '@/features/sites/server';
import { getAccess } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Site detail' };

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
  const [detail, access] = await Promise.all([getSiteDetail(siteId, range, now), getAccess()]);
  if (!detail) notFound();
  const active = access.status === 'active' ? access : null;
  return (
    <Container>
      <SiteDetailView
        detail={detail}
        range={range}
        role={active?.profile.role ?? null}
        meId={active?.profile.id ?? ''}
        nowIso={now.toISOString()}
      />
    </Container>
  );
}
