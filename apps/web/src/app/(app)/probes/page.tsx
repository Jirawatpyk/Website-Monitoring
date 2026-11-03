import type { Metadata } from 'next';
import { Button, Container, PageHeader } from '@jirawatpyk/aura-react';
import { IconExternalLink } from '@jirawatpyk/aura-react/icons';
import { ProbesView } from '@/features/probes';
import { getProbes } from '@/features/probes/server';
import { NoAccess } from '@/components/states';
import { getAccess } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Probes & heartbeat' };

const HEALTHCHECKS_URL = 'https://healthchecks.io/';

/** `/probes` — Probes & heartbeat (board Probes, spec §14.4, §15.3; S12a). Staff, read only. */
export default async function ProbesPage() {
  const access = await getAccess();
  const header = (
    <PageHeader
      titleHideBelow="lg"
      eyebrow="SYSTEM"
      title="Probes & heartbeat"
      meta="The biggest risk of building it ourselves: the monitor dies quietly and everyone thinks the sites are fine."
      actionsFullWidthBelow="md"
      actions={
        <Button
          variant="secondary"
          href={HEALTHCHECKS_URL}
          target="_blank"
          rel="noopener noreferrer"
          icon={<IconExternalLink />}
        >
          Open Healthchecks.io
        </Button>
      }
    />
  );
  if (access.status !== 'active' || access.profile.role === 'client') {
    return (
      <Container>
        <div className="flex flex-col gap-6">
          {header}
          <NoAccess
            title="Probes & heartbeat is for the DxT team"
            description="Ask an Admin if you need it."
          />
        </div>
      </Container>
    );
  }
  const data = await getProbes(access.profile.role === 'admin');
  return (
    <Container>
      <div className="flex flex-col gap-6">
        {header}
        <ProbesView data={data} />
      </div>
    </Container>
  );
}
