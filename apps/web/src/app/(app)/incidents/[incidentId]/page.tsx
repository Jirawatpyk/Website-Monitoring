import type { Metadata } from 'next';
import { Button, Container, EmptyState } from '@jirawatpyk/aura-react';
import { IconInbox } from '@jirawatpyk/aura-react/icons';
import { IncidentDetailView } from '@/features/incidents';
import { getIncident } from '@/features/incidents/server';
import { getAccess } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Incident' };
// Ack and resolve send their held messages after the 10 s Undo window (`after()`): room for that.
export const maxDuration = 60;

/**
 * Incident page — Incident / MIncident (S07, D-033), at the URL the Chat card and the emails link to
 * since S02b (D-016); `?ack=1` and `#resolve` are accepted.
 */
export default async function IncidentPage({ params }: { params: Promise<{ incidentId: string }> }) {
  const { incidentId } = await params;
  const now = new Date();
  const [detail, access] = await Promise.all([getIncident(incidentId, now), getAccess()]);
  if (!detail || access.status !== 'active') {
    return (
      <EmptyState
        icon={<IconInbox />}
        title="Incident not found"
        description="The link may be wrong, or the incident was removed."
        action={<Button href="/incidents">Go to Incidents</Button>}
      />
    );
  }
  return (
    <Container>
      <IncidentDetailView
        detail={detail}
        viewerName={access.profile.displayName}
        viewerEmail={access.profile.email}
        nowIso={now.toISOString()}
      />
    </Container>
  );
}
