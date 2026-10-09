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
  const [{ siteId }, query, access] = await Promise.all([params, searchParams, getAccess()]);
  const range = rangeOf(query.range);
  const now = new Date();
  const detail = await getSiteDetail(siteId, range, now);
  if (!detail) notFound();
  const isAdmin = access.status === 'active' && access.profile.role === 'admin';
  return (
    <Container>
      <SiteDetailView detail={detail} range={range} isAdmin={isAdmin} nowIso={now.toISOString()} />
    </Container>
  );
}
