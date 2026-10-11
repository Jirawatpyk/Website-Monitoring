import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Alert, Breadcrumb, Button, Container, PageHeader } from '@jirawatpyk/aura-react';
import { IconExternalLink } from '@jirawatpyk/aura-react/icons';
import { formatTier, TIER_CONFIG } from '@dxt/shared';
import { NoAccess } from '@/components/states';
import { SiteForm } from '@/features/sites';
import { getRegistrationOptions, getSite } from '@/features/sites/server';
import { getAccess } from '@/lib/auth/session';
import { probeAllowlistInfo } from '@/lib/env';

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
  searchParams: Promise<{ draft?: string; started?: string; saved?: string; stopped?: string }>;
}) {
  const [{ siteId }, query, access] = await Promise.all([params, searchParams, getAccess()]);
  const [site, options] = await Promise.all([
    getSite(siteId),
    access.status === 'active' && access.profile.role === 'admin' ? getRegistrationOptions() : null,
  ]);
  if (!site) notFound();
  const isAdmin = access.status === 'active' && access.profile.role === 'admin';
  const every = TIER_CONFIG[site.tier].intervalSec / 60;
  const primaryUrl = site.monitors.find((m) => m.isPrimary)?.url;
  const header = (
    <PageHeader
      // Phones: Visit site spans the row, as every page's header actions (layout-consistency).
      className="max-md:[&>:last-child]:w-full"
      breadcrumb={<Breadcrumb items={[{ label: 'Sites', href: '/sites' }, { label: site.name }]} />}
      title="Edit site"
      actions={
        primaryUrl ? (
          <Button
            variant="secondary"
            className="max-md:w-full"
            href={primaryUrl}
            target="_blank"
            rel="noopener noreferrer"
            iconRight={<IconExternalLink />}
            aria-label={`Visit site: ${site.name} (opens in a new tab)`}
          >
            Visit site
          </Button>
        ) : undefined
      }
      meta={
        site.live
          ? `${formatTier(site.tier)} · every ${every} min from BKK, SIN, TYO · monitoring`
          : `${formatTier(site.tier)} · Draft · not monitored`
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
  const probe = probeAllowlistInfo();
  return (
    <Container>
      <div className="flex flex-col gap-6">
        {header}
        {query.saved && (
          <Alert tone="success" role="status" title="Changes saved">
            Every change is in the audit log.
          </Alert>
        )}
        {query.stopped && !site.live && (
          <Alert tone="success" role="status" title="Monitoring stopped">
            Checks have stopped and nobody is alerted about this site. Start monitoring again from this page.
          </Alert>
        )}
        {query.draft && !site.live && (
          <Alert tone="success" role="status" title="Draft saved">
            Nothing is checked until monitoring starts. Finish the checklist, then press Start monitoring.
          </Alert>
        )}
        <SiteForm
          key={`${site.id}-${site.live}`}
          options={options!}
          site={site}
          bkkIp={probe.bkkIp}
          secretHeaderName={probe.secretHeaderName}
          started={site.live && /^\d{2}:\d{2}$/.test(query.started ?? '') ? query.started : null}
        />
      </div>
    </Container>
  );
}
