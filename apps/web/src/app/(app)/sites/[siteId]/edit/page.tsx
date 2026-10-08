import type { Metadata } from 'next';
import { Alert, Breadcrumb, Button, Container, EmptyState, PageHeader } from '@jirawatpyk/aura-react';
import { IconExternalLink, IconInbox } from '@jirawatpyk/aura-react/icons';
import { formatTier, TIER_CONFIG } from '@dxt/shared';
import { NoAccess } from '@/components/states';
import { SiteForm } from '@/features/sites';
import { getRegistrationOptions, getSite } from '@/features/sites/server';
import { getAccess } from '@/lib/auth/session';
import { serverEnv } from '@/lib/env';

export const metadata: Metadata = { title: 'Edit site' };

/**
 * Edit site — the AddSite form for an existing site, with Start / Stop monitoring and Delete for a
 * Draft (S05, D-025). Rows of `/sites` open it until site detail (S06).
 */
export default async function EditSitePage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ draft?: string; started?: string }>;
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
  const primaryUrl = site.monitors.find((m) => m.isPrimary)?.url;
  const header = (
    <PageHeader
      breadcrumb={<Breadcrumb items={[{ label: 'Sites', href: '/sites' }, { label: site.name }]} />}
      title="Edit site"
      actions={
        primaryUrl ? (
          <Button
            variant="secondary"
            href={primaryUrl}
            target="_blank"
            rel="noopener noreferrer"
            iconRight={<IconExternalLink />}
            aria-label={`Visit ${site.name} (opens in a new tab)`}
          >
            Visit site
          </Button>
        ) : undefined
      }
      meta={
        site.live
          ? `${formatTier(site.tier)} · every ${every} min from BKK, SIN, TYO · monitoring`
          : `${formatTier(site.tier)} · Draft — not monitored yet`
      }
    />
  );
  if (!isAdmin) {
    return (
      <Container>
        <div className="flex flex-col gap-6">
          {header}
          <NoAccess
            title="Only an Admin can change a site"
            description="Sites, owners and monitors are set up by an Admin. Ask one to make the change."
          />
        </div>
      </Container>
    );
  }
  const options = await getRegistrationOptions();
  const env = serverEnv();
  return (
    <Container>
      <div className="flex flex-col gap-6">
        {header}
        {query.started && site.live && (
          <Alert tone="success" role="status" title="Monitoring started">
            First round within {every} min from BKK, SIN and TYO · in the audit log.
          </Alert>
        )}
        {query.draft && !site.live && (
          <Alert tone="success" role="status" title="Draft saved">
            Nothing is checked until monitoring starts. Finish the checklist, then press Start monitoring.
          </Alert>
        )}
        <SiteForm
          key={`${site.id}-${site.live}`}
          options={options}
          site={site}
          bkkIp={env.BKK_PROBE_IP ?? null}
          secretHeaderName={env.PROBE_SECRET_HEADER_NAME}
        />
      </div>
    </Container>
  );
}
