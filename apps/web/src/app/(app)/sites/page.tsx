import type { Metadata } from 'next';
import { Button, Container, EmptyState, PageHeader } from '@jirawatpyk/aura-react';
import { IconMonitor, IconPlus } from '@jirawatpyk/aura-react/icons';
import { SitesTable } from '@/features/sites';
import { listSites } from '@/features/sites/server';
import { getAccess } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Sites' };

/** `/sites` — the all-sites table of the Main board, full width (docs/design/screens.md, S05). */
export default async function SitesPage() {
  const [sites, access] = await Promise.all([listSites(), getAccess()]);
  const isAdmin = access.status === 'active' && access.profile.role === 'admin';
  const live = sites.filter((s) => s.live).length;
  const drafts = sites.length - live;
  const meta =
    sites.length === 0
      ? undefined
      : `${sites.length} ${sites.length === 1 ? 'site' : 'sites'} · ${live} monitored${drafts ? ` · ${drafts} ${drafts === 1 ? 'draft' : 'drafts'}` : ''}`;

  return (
    <Container>
      <div className="flex flex-col gap-6">
        <PageHeader
          eyebrow="SITES"
          title="Sites"
          meta={meta}
          actions={
            isAdmin && sites.length > 0 ? (
              <Button icon={<IconPlus />} href="/sites/new">
                Add site
              </Button>
            ) : undefined
          }
        />
        {sites.length === 0 ? (
          <EmptyState
            icon={<IconMonitor />}
            title="No sites yet"
            description={
              isAdmin
                ? 'Add the first site with its owners, client and primary URL. Monitoring starts when its registration checklist is complete.'
                : 'An Admin adds sites. They show here once they are registered.'
            }
            action={
              isAdmin ? (
                <Button icon={<IconPlus />} href="/sites/new">
                  Add first site
                </Button>
              ) : undefined
            }
          />
        ) : (
          <SitesTable sites={sites} canEdit={isAdmin} />
        )}
      </div>
    </Container>
  );
}
