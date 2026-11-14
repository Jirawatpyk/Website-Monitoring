import type { Metadata } from 'next';
import { Container } from '@jirawatpyk/aura-react';
import { SettingsNoAccess, UsersPageView } from '@/features/settings';
import { getUsersPage } from '@/features/settings/server';
import { getAccess } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Users & roles' };
// A role change or deactivation can hand over shifts, whose on-call messages leave from the request.
export const maxDuration = 60;

/**
 * `/settings/users` — Users & roles (boards Users, MUsers; spec §14.9, §35; S16, D-062). Admins only:
 * everyone else gets No access (§35), and the SQL functions refuse anyone but an Admin anyway.
 */
export default async function UsersPage() {
  const access = await getAccess();
  if (access.status !== 'active' || access.profile.role !== 'admin') {
    const viewer =
      access.status === 'active' ? { name: access.profile.displayName, role: access.profile.role } : null;
    return (
      <Container>
        <SettingsNoAccess current="users" viewer={viewer} />
      </Container>
    );
  }
  const page = await getUsersPage({ id: access.profile.id });
  return (
    <Container>
      <UsersPageView data={page.data} now={page.now} />
    </Container>
  );
}
