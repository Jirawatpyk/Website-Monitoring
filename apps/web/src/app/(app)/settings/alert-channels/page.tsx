import type { Metadata } from 'next';
import { Container } from '@jirawatpyk/aura-react';
import { AlertChannelsPageView } from '@/features/channels';
import { getChannelsPage } from '@/features/channels/server';
import { SettingsNoAccess } from '@/features/settings';
import { getAccess } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Alert channels' };
// A test alert leaves from the request (after the response).
export const maxDuration = 60;

/**
 * `/settings/alert-channels` — Alert channels (board AlertChannels; spec §10, §14.8, §15.5, §22.5; S17,
 * D-069). Admins only: the delivery log reads `notifications`, which is Admin-only by RLS.
 */
export default async function AlertChannelsPage() {
  const access = await getAccess();
  if (access.status !== 'active' || access.profile.role !== 'admin') {
    const viewer =
      access.status === 'active' ? { name: access.profile.displayName, role: access.profile.role } : null;
    return (
      <Container>
        <SettingsNoAccess current="channels" viewer={viewer} />
      </Container>
    );
  }
  const page = await getChannelsPage({ id: access.profile.id });
  return (
    <Container>
      <AlertChannelsPageView data={page.data} now={page.now} />
    </Container>
  );
}
