import type { Metadata } from 'next';
import { Breadcrumb, Button, Container, EmptyState, PageHeader } from '@jirawatpyk/aura-react';
import { IconInbox } from '@jirawatpyk/aura-react/icons';
import { formatTier, TIER_CONFIG } from '@dxt/shared';
import { NoAccess } from '@/components/states';
import { MonitorsEditor } from '@/features/sites';
import { getSite } from '@/features/sites/server';
import { getAccess } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Edit monitors' };

/** Edit monitors — board EditMonitors (S05, D-025). Admins only (D-012). */
export default async function EditMonitorsPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const [{ siteId }, query, access] = await Promise.all([params, searchParams, getAccess()]);
  const site = await getSite(siteId);
  if (!site) {
    return (
      <EmptyState
        icon={<IconInbox />}
        title="Site not found"
        description="The link may be wrong, or the site was deleted."
        action={<Button href="/sites">Go to Sites</Button>}
      />
    );
  }
  const isAdmin = access.status === 'active' && access.profile.role === 'admin';
  const every = TIER_CONFIG[site.tier].intervalSec / 60;
  const breadcrumb = (
    <Breadcrumb
      items={[
        { label: 'Sites', href: '/sites' },
        { label: site.name, href: `/sites/${site.id}/edit` },
        { label: 'Monitors' },
      ]}
    />
  );
  const meta = `${formatTier(site.tier)} · every ${every} min from BKK, SIN, TYO${site.ownerName ? ` · owner ${site.ownerName}` : ''} · site status is the worst of these monitors`;
  return (
    <Container>
      <div className="flex flex-col gap-6">
        {isAdmin ? (
          <MonitorsEditor
            key={JSON.stringify(site.monitors)}
            siteId={site.id}
            siteName={site.name}
            tier={site.tier}
            ownerName={site.ownerName}
            backupName={site.backupName}
            monitors={site.monitors}
            breadcrumb={breadcrumb}
            meta={meta}
            saved={!!query.saved}
          />
        ) : (
          <>
            <PageHeader breadcrumb={breadcrumb} title="Edit monitors" meta={meta} />
            <NoAccess
              title="Only an Admin can change monitors"
              description="Monitors decide when people are alerted, so an Admin changes them. Ask one to make the change."
            />
          </>
        )}
      </div>
    </Container>
  );
}
