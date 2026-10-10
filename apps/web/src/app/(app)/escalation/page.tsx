import type { Metadata } from 'next';
import { Container, PageHeader } from '@jirawatpyk/aura-react';
import { EscalationEditor, EscalationView } from '@/features/escalation';
import { getEscalationPage } from '@/features/escalation/server';
import { getAccess } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Escalation policies' };

/**
 * `/escalation` — Escalation (L0–L1) for an Admin from md; MEscalation, read-only, on phones and for
 * everyone else (spec §8, §14.7, §15.5, §22; D-034). "Change history" waits for the Audit log (S15).
 */
export default async function EscalationPage() {
  const [access, data] = await Promise.all([getAccess(), getEscalationPage()]);
  const admin = access.status === 'active' && access.profile.role === 'admin';
  const now = new Date().toISOString();
  return (
    <Container>
      <div className="flex flex-col gap-6">
        <PageHeader
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
