import type { Metadata } from 'next';
import { Container, PageHeader } from '@jirawatpyk/aura-react';
import { GuidePage, defaultChip } from '@/features/guide';
import { getGuidePage, guideTopics } from '@/features/guide/server';
import { NoAccess } from '@/components/states';
import { getAccess } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'User guide' };

/**
 * `/guide` — User guide (boards Guide, MGuide; spec §18, FR-22; S18, D-070). Every staff role reads
 * it; the topics open on the viewer's own role, or On-call during their shift.
 */
export default async function GuideRoute() {
  const access = await getAccess();
  const header = (
    <PageHeader
      titleHideBelow="lg"
      eyebrow="HELP"
      title="User guide"
      meta={
        <span className="max-lg:hidden">
          How DxT Monitor alerts, escalates and resolves — the rules exactly as the app applies them, by role.
        </span>
      }
    />
  );
  if (access.status !== 'active' || access.profile.role === 'client') {
    return (
      <Container>
        <div className="flex flex-col gap-6">
          {header}
          <NoAccess title="The user guide is for the DxT team" description="Ask an Admin if you need it." />
        </div>
      </Container>
    );
  }
  const data = await getGuidePage({ id: access.profile.id, role: access.profile.role });
  return (
    <Container>
      <div className="flex flex-col gap-6">
        {header}
        <GuidePage
          desktop={guideTopics(data.facts, 'desktop')}
          phone={guideTopics(data.facts, 'phone')}
          mine={defaultChip(data.role, data.onCallNow)}
        />
      </div>
    </Container>
  );
}
