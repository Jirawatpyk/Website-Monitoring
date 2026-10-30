import type { Metadata } from 'next';
import { Container, PageHeader } from '@jirawatpyk/aura-react';
import { z } from 'zod';
import { OncallPageView, type Viewer } from '@/features/oncall';
import { getOncallPage } from '@/features/oncall/server';
import { NoAccess } from '@/components/states';
import { getAccess } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'On-call' };
// On-call actions send their messages from the request (`after()`, no Undo — §27.1): room for that.
export const maxDuration = 60;

const uuid = z.uuid();
const idOf = (v: string | string[] | undefined) => {
  const p = uuid.safeParse(Array.isArray(v) ? v[0] : v);
  return p.success ? p.data : null;
};

/**
 * `/oncall` — On-call (boards OnCall and MOnCall, spec §27, §28; D-048). `?swap=<id>` opens a swap
 * request (the Chat / email link); `?test=<token>` is the test-alert link, confirmed by the page once
 * it is up (never during this render — a prefetch would use it up). Admin: rotation, hand-over,
 * approvals; Responders: their weeks and swaps; AM, CEO, Viewer: read only.
 */
export default async function OncallPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await getAccess();
  if (access.status !== 'active' || access.profile.role === 'client') {
    return (
      <Container>
        <div className="flex flex-col gap-6">
          <PageHeader titleHideBelow="lg" eyebrow="OPERATIONS" title="On-call" />
          <NoAccess
            title="On-call is for the DxT team"
            description="Ask an Admin if you need to know who is on call."
          />
        </div>
      </Container>
    );
  }
  const { profile } = access;
  const params = await searchParams;
  const viewer: Viewer = {
    id: profile.id,
    name: profile.displayName,
    role: profile.role === 'admin' ? 'admin' : profile.role === 'responder' ? 'responder' : 'readonly',
  };
  const data = await getOncallPage(viewer, idOf(params.swap));
  return (
    <Container>
      <OncallPageView data={data} testToken={idOf(params.test)} />
    </Container>
  );
}
