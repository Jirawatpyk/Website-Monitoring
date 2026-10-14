import type { Metadata } from 'next';
import { Container, PageHeader } from '@jirawatpyk/aura-react';
import { MaintenancePageView, type Viewer } from '@/features/maintenance';
import { getMaintenancePage } from '@/features/maintenance/server';
import { NoAccess } from '@/components/states';
import { getAccess } from '@/lib/auth/session';
import { PHONE_BAR_HEADER } from '@/components/phone-header';

export const metadata: Metadata = { title: 'Maintenance & mutes' };
// Maintenance actions send their messages after the 10 s Undo window (`after()`, §24.8): room for that.
export const maxDuration = 60;

/**
 * `/maintenance` — Maintenance & mutes (spec §23, boards MaintenancePage and MMaintenanceList; D-036).
 * Admin: every action; Responder: own sites and own requests; AM, CEO, Viewer: read only.
 */
export default async function MaintenancePage() {
  const access = await getAccess();
  if (access.status !== 'active' || access.profile.role === 'client') {
    return (
      <Container>
        <div className="flex flex-col gap-6">
          <PageHeader className={PHONE_BAR_HEADER} eyebrow="OPERATIONS" title="Maintenance & mutes" />
          <NoAccess
            title="Maintenance & mutes are for the DxT team"
            description="Ask an Admin if you need to know when a site has planned work."
          />
        </div>
      </Container>
    );
  }
  const { profile } = access;
  const now = new Date();
  const editor = profile.role === 'admin' || profile.role === 'responder';
  const { rows, sites } = await getMaintenancePage(now, editor);
  const viewer: Viewer = {
    id: profile.id,
    name: profile.displayName,
    role: profile.role === 'admin' ? 'admin' : profile.role === 'responder' ? 'responder' : 'readonly',
  };
  // Responders only see the sites they own or back up in the dialog (§23.1).
  const pausable = sites
    .filter((s) => viewer.role === 'admin' || (viewer.role === 'responder' && s.ownerIds.includes(viewer.id)))
    .map(({ ownerIds: _ownerIds, ...s }) => s);
  return (
    <Container>
      <MaintenancePageView
        rows={rows}
        sites={pausable}
        viewer={viewer}
        viewerEmail={profile.email}
        nowIso={now.toISOString()}
      />
    </Container>
  );
}
