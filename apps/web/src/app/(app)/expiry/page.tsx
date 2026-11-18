import type { Metadata } from 'next';
import { Container, PageHeader } from '@jirawatpyk/aura-react';
import { ExpiryView } from '@/features/expiry';
import { getExpiry } from '@/features/expiry/server';
import { NoAccess } from '@/components/states';
import { getAccess } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'SSL & domains' };

/** `/expiry` — SSL & domains (board Expiry, spec §14.12, §15.8; S13, D-066). Staff; Check now for Admins and Responders. */
export default async function ExpiryPage() {
  // both at once: RLS keeps site_expiry to staff, so the read is safe before the role is known
  const [access, data] = await Promise.all([getAccess(), getExpiry()]);
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
  const role = access.profile.role;
  return (
    <Container>
      <ExpiryView data={data} canCheck={role === 'admin' || role === 'responder'} />
    </Container>
  );
}
