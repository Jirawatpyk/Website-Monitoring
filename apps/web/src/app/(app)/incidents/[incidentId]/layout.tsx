import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getIncidentNumber } from '@/features/incidents/server';

/**
 * An incident that doesn't exist (or can't be read) answers 404. The check sits here, above the page's
 * `loading.tsx`: inside it the skeleton has already streamed a 200 by the time the page finds nothing. The
 * read is request-cached and shared with the phone bar; "Incident not found" is `incidents/not-found.tsx`.
 */
export default async function IncidentLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ incidentId: string }>;
}) {
  const { incidentId } = await params;
  if ((await getIncidentNumber(incidentId)) === null) notFound();
  return children;
}
