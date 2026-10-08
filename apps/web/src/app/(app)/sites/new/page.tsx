import type { Metadata } from 'next';
import { Breadcrumb, Container, PageHeader } from '@jirawatpyk/aura-react';
import { NoAccess } from '@/components/states';
import { SiteForm } from '@/features/sites';
import { getRegistrationOptions } from '@/features/sites/server';
import { getAccess } from '@/lib/auth/session';
import { serverEnv } from '@/lib/env';

export const metadata: Metadata = { title: 'Add site' };

/** Add site — board AddSite (S05, D-025). Admins only: sites and monitors are Admin-edited (D-012). */
export default async function AddSitePage() {
  const access = await getAccess();
  const isAdmin = access.status === 'active' && access.profile.role === 'admin';
  const header = (
    <PageHeader
      breadcrumb={<Breadcrumb items={[{ label: 'Sites', href: '/sites' }, { label: 'Add site' }]} />}
      title="Add site"
      meta="Monitoring starts only when the registration checklist is complete."
    />
  );
  if (!isAdmin) {
    return (
      <Container>
        <div className="flex flex-col gap-6">
          {header}
          <NoAccess
            title="Only an Admin can add a site"
            description="Sites, owners and monitors are set up by an Admin. Ask one to register the site."
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
        <SiteForm
          options={options}
          bkkIp={env.BKK_PROBE_IP ?? null}
          secretHeaderName={env.PROBE_SECRET_HEADER_NAME}
        />
      </div>
    </Container>
  );
}
