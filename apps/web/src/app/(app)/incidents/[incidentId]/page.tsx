import type { Metadata } from 'next';
import { Button, EmptyState } from '@jirawatpyk/aura-react';
import { IncidentAckView } from '@/features/incidents';
import { getIncidentForAck } from '@/features/incidents/server';
import { getAccess } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Incident' };

/**
 * Incident page — MobileAck / MobileAckDark (S02b, D-016); the Chat card and the email link here
 * (`?ack=1` is accepted and changes nothing). S07 grows it into the Incident board.
 */
export default async function IncidentPage({ params }: { params: Promise<{ incidentId: string }> }) {
  const { incidentId } = await params;
  const [view, access] = await Promise.all([getIncidentForAck(incidentId), getAccess()]);
  if (!view || access.status !== 'active') {
    return (
      <EmptyState
        icon="inbox"
        title="Incident not found"
        description="The link may be wrong, or the incident was removed."
        action={<Button href="/">Go to Overview</Button>}
      />
    );
  }
  return (
    <IncidentAckView view={view} viewerName={access.profile.displayName} viewerEmail={access.profile.email} />
  );
}
