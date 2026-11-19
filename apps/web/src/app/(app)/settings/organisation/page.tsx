import type { Metadata } from 'next';
import { Container } from '@jirawatpyk/aura-react';
import { OrganisationPageView } from '@/features/organisation';
import { getOrganisationPage } from '@/features/organisation/server';
import { SettingsNoAccess } from '@/features/settings';
import { getAccess } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Organisation' };

/**
 * `/settings/organisation` — Organisation (board Organisation; spec §7, §14.14, §22.5; S17, D-069).
 * Admins only: everyone else gets No access, and `save_response_hours` refuses anyone but an Admin.
 */
export default async function OrganisationPage() {
  const access = await getAccess();
  if (access.status !== 'active' || access.profile.role !== 'admin') {
    const viewer =
      access.status === 'active' ? { name: access.profile.displayName, role: access.profile.role } : null;
    return (
      <Container>
        <SettingsNoAccess current="organisation" viewer={viewer} />
      </Container>
    );
  }
  const data = await getOrganisationPage();
  return (
    <Container>
      <OrganisationPageView data={data} />
    </Container>
  );
}
