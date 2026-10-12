import type { Metadata } from 'next';
import { Button, Container, PageHeader } from '@jirawatpyk/aura-react';
import { IconPlus } from '@jirawatpyk/aura-react/icons';
import { listMeta, SitesEmpty, SitesList } from '@/features/sites';
import { chatConnected, listSites } from '@/features/sites/server';
import { getAccess } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Sites' };
// Maintenance actions send their messages after the 10 s Undo window (`after()`, §24.8): room for that.
export const maxDuration = 60;

/** `/sites` — the Sites list (spec §20, boards Sites and MSites). */
export default async function SitesPage() {
  const [sites, access] = await Promise.all([listSites(), getAccess()]);
  const active = access.status === 'active' ? access : null;
  const isAdmin = active?.profile.role === 'admin';

  return (
    <Container>
      <div className="flex flex-col gap-6">
        <PageHeader
          eyebrow="SITES"
          title="Sites"
          meta={listMeta(sites)}
          actions={
            isAdmin && sites.length > 0 ? (
              <span className="max-md:hidden">
                <Button icon={<IconPlus />} href="/sites/new">
                  Add site
                </Button>
              </span>
            ) : undefined
          }
        />
        {/* Phones: full width under the header, as /maintenance's Schedule button. */}
        {isAdmin && sites.length > 0 && (
          <span className="md:hidden">
            <Button icon={<IconPlus />} href="/sites/new" fullWidth>
              Add site
            </Button>
          </span>
        )}
        {sites.length === 0 ? (
          <SitesEmpty isAdmin={isAdmin} chatConnected={chatConnected()} />
        ) : (
          <SitesList
            sites={sites}
            isAdmin={isAdmin}
            meId={active?.profile.id ?? ''}
            viewer={{ name: active?.profile.displayName ?? '', email: active?.profile.email ?? '' }}
            nowIso={new Date().toISOString()}
          />
        )}
      </div>
    </Container>
  );
}
