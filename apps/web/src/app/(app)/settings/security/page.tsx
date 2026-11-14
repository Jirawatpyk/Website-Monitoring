import type { Metadata } from 'next';
import { Container } from '@jirawatpyk/aura-react';
import { SecurityPageView, SettingsNoAccess } from '@/features/settings';
import { getSecurityPage } from '@/features/settings/server';
import { getAccess } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Sign-in & security' };

/**
 * `/settings/security` — Sign-in & security (boards Security, MSecurity; spec §35; S16 PR 3, D-062).
 * Admins only: everyone else gets No access (§35); `list_sessions` and the sign-out functions refuse
 * them anyway.
 */
export default async function SecurityPage() {
  const access = await getAccess();
  if (access.status !== 'active' || access.profile.role !== 'admin') {
    const viewer =
      access.status === 'active' ? { name: access.profile.displayName, role: access.profile.role } : null;
    return (
      <Container>
        <SettingsNoAccess current="security" viewer={viewer} />
      </Container>
    );
  }
  const page = await getSecurityPage({ id: access.profile.id });
  return (
    <Container>
      <SecurityPageView data={page.data} now={page.now} />
    </Container>
  );
}
