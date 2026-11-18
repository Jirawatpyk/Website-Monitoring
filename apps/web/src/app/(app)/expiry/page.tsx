import type { Metadata } from 'next';
import { Container, PageHeader } from '@jirawatpyk/aura-react';
import { ExpiryView } from '@/features/expiry';
import { getExpiry } from '@/features/expiry/server';
import { NoAccess } from '@/components/states';
import { getAccess } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'SSL & domains' };

/** `/expiry` — SSL & domains (board Expiry, spec §14.12, §15.8; S13, D-066). Staff; Check now for Admins and Responders. */
export default async function ExpiryPage() {
  const access = await getAccess();
  if (access.status !== 'active' || access.profile.role === 'client') {
    return (
      <Container>
        <div className="flex flex-col gap-6">
          <PageHeader titleHideBelow="lg" eyebrow="SITES" title="SSL & domains" />
          <NoAccess title="SSL & domains is for the DxT team" description="Ask an Admin if you need it." />
        </div>
      </Container>
    );
  }
  const data = await getExpiry();
  const role = access.profile.role;
  return (
    <Container>
      <ExpiryView data={data} canCheck={role === 'admin' || role === 'responder'} />
    </Container>
  );
}
