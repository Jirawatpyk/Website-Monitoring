import { formatIncidentId } from '@dxt/shared';
import { PhoneBar } from '@/components/app-shell/phone-bar';
import { phoneBarFor } from '@/components/app-shell/phone-bar-routes';
import { getIncidentNumber } from '@/features/incidents/server';

/**
 * The incident's phone top bar (MIncident, D-045): back to Incidents and the INC number. The slot sits outside
 * the page's error boundary, so a failed read falls back to "Incident" instead of failing the page.
 */
export default async function IncidentBar({ params }: { params: Promise<{ incidentId: string }> }) {
  const { incidentId } = await params;
  const fallback = phoneBarFor(`/incidents/${incidentId}`);
  const number = await getIncidentNumber(incidentId).catch(() => null);
  return (
    <PhoneBar title={number === null ? fallback.title : formatIncidentId(number)} back={fallback.back} />
  );
}
