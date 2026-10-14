import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Container } from '@jirawatpyk/aura-react';
import { formatIncidentId } from '@dxt/shared';
import { IncidentDetailView, incidentSections } from '@/features/incidents';
import { getIncident } from '@/features/incidents/server';
import { getAccess } from '@/lib/auth/session';

/** The tab names the incident and the site, as Site detail names its site. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ incidentId: string }>;
}): Promise<Metadata> {
  const detail = await getIncident((await params).incidentId);
  return {
    title: detail
      ? `${formatIncidentId(Number(detail.view.id.slice(4)))} · ${detail.siteName}`
      : 'Incident not found',
  };
}
// Ack and resolve send their held messages after the 10 s Undo window (`after()`): room for that.
export const maxDuration = 60;

/**
 * Incident page — Incident / MIncident (S07, D-033), at the URL the Chat card and the emails link to
 * since S02b (D-016); `?ack=1` and `#resolve` are accepted.
 */
export default async function IncidentPage({ params }: { params: Promise<{ incidentId: string }> }) {
  const { incidentId } = await params;
  const now = new Date();
  const [detail, access] = await Promise.all([getIncident(incidentId), getAccess()]);
  if (!detail || access.status !== 'active') notFound();
  return (
    <Container>
      <IncidentDetailView
        detail={detail}
        sections={incidentSections(detail, now)}
        viewerName={access.profile.displayName}
        viewerEmail={access.profile.email}
      />
    </Container>
  );
}
