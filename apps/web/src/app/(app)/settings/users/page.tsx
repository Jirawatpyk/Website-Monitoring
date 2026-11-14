import type { Metadata } from 'next';
import { Button, Container } from '@jirawatpyk/aura-react';
import { IconArrowLeft } from '@jirawatpyk/aura-react/icons';
import { ROLE_LABELS } from '@dxt/shared';
import { SettingsHeader, UsersPageView } from '@/features/settings';
import { getUsersPage } from '@/features/settings/server';
import { NoAccess } from '@/components/states';
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
    const who =
      access.status === 'active'
        ? `You’re signed in as ${access.profile.displayName} (${ROLE_LABELS[access.profile.role]}). `
        : '';
    return (
      <Container>
        <div className="flex flex-col gap-6">
          <SettingsHeader current="users" />
          <NoAccess
            title="Only Admins can see Settings"
            description={`${who}Ask an Admin if something here needs to change.`}
          />
          <div>
            <Button variant="secondary" icon={<IconArrowLeft />} href="/" fullWidth="below-md">
              Back to Overview
            </Button>
          </div>
        </div>
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
