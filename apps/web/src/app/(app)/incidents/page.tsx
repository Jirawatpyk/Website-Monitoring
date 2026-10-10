import type { Metadata } from 'next';
import { Container } from '@jirawatpyk/aura-react';
import { formatDay, formatTime } from '@dxt/shared';
import { IncidentsList } from '@/features/incidents';
import { listIncidents } from '@/features/incidents/server';

export const metadata: Metadata = { title: 'Incidents' };

/** `/incidents` — Incidents / MIncidents (spec §4, §11, §16.1; D-033). */
export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const [{ view }, list] = await Promise.all([searchParams, listIncidents()]);
  const now = new Date();
  const asked = typeof view === 'string' ? view : undefined;
  return (
    <Container>
      <div className="flex flex-col gap-6">
        <IncidentsList
          meta={`${formatDay(now, { weekday: true, year: true })} · ${formatTime(now)} (UTC+7)`}
          incidents={list?.incidents ?? []}
          sites={list?.sites ?? []}
          nowIso={now.toISOString()}
          viewer={list?.viewer ?? { id: '', role: 'viewer' }}
          initialView={
            asked === 'unacked' || asked === 'past' || asked === 'open' || asked === 'done' || asked === 'all'
              ? asked
              : undefined
          }
        />
      </div>
    </Container>
  );
}
