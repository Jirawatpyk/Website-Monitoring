import type { Metadata } from 'next';
import { Container, PageHeader } from '@jirawatpyk/aura-react';
import { EscalationEditor, EscalationView } from '@/features/escalation';
import { getEscalationPage } from '@/features/escalation/server';
import { NoAccess } from '@/components/states';
import { getAccess } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Escalation policies' };

/**
 * `/escalation` — Escalation (L0–L1) for an Admin from md; MEscalation, read-only, on phones and for
 * everyone else (spec §8, §14.7, §15.5, §22; D-034). "Change history" waits for the Audit log (S15).
 */
export default async function EscalationPage() {
  const access = await getAccess();
  // Staff read the policies (RLS); anyone else gets the no-access state, not an error page.
  if (access.status !== 'active' || access.profile.role === 'client') {
    return (
      <Container>
        <div className="flex flex-col gap-6">
          <PageHeader titleHideBelow="lg" eyebrow="OPERATIONS" title="Escalation policies" />
          <NoAccess
            title="Escalation policies are for the DxT team"
            description="Ask an Admin if you need to see who is paged when a site goes down."
          />
        </div>
      </Container>
    );
  }
  const data = await getEscalationPage();
  const admin = access.profile.role === 'admin';
  const now = new Date().toISOString();
  return (
    <Container>
      <div className="flex flex-col gap-6">
        <PageHeader
          titleHideBelow="lg"
          eyebrow="OPERATIONS"
          title="Escalation policies"
          meta="One person must acknowledge. No ack in time → the next level is notified. Acknowledge stops this chain."
        />
        {admin ? (
          <>
            <div className="hidden md:block">
              <EscalationEditor data={data} now={now} />
            </div>
            <div className="md:hidden">
              <EscalationView data={data} now={now} admin />
            </div>
          </>
        ) : (
          <div className="max-w-xl">
            <EscalationView data={data} now={now} admin={false} />
          </div>
        )}
      </div>
    </Container>
  );
}
