import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Container } from '@jirawatpyk/aura-react';
import { signOut } from '@/features/auth/server';
import { ProfilePageView } from '@/features/profile';
import { getProfilePage } from '@/features/profile/server';
import { getAccess } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'My profile' };

/**
 * `/profile` — My profile (boards Profile, MProfile; spec §22.6, §10; S16 PR 3, D-062 items 6, 12).
 * Every signed-in role, their own data only. The layout already sent anyone without an active profile
 * away; this is the belt to that.
 */
export default async function ProfilePage() {
  const access = await getAccess();
  if (access.status !== 'active') redirect('/login');
  const page = await getProfilePage({ id: access.profile.id });
  return (
    <Container>
      <ProfilePageView data={page.data} now={page.now} signOutAction={signOut} />
    </Container>
  );
}
