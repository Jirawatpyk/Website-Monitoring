import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { AppShell } from '@jirawatpyk/aura-react';
import { AppNav } from '@/components/app-shell/app-nav';
import { Brand } from '@/components/app-shell/brand';
import { OfflineStrip } from '@/components/states';
import { AccountFooter } from '@/features/auth';
import { getAccess } from '@/lib/auth/session';

/**
 * Signed-in frame. The proxy already sent signed-out people to /login; a session without an active
 * profile (deactivated, or never on the access list) is signed out by /auth/refused (D-007).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const access = await getAccess();
  if (access.status === 'signed-out') redirect('/login');
  if (access.status !== 'active') redirect('/auth/refused');
  const { profile } = access;

  return (
    <AppShell
      nav={
        <AppNav
          header={<Brand />}
          footer={<AccountFooter displayName={profile.displayName} role={profile.role} />}
        />
      }
    >
      <OfflineStrip />
      {children}
    </AppShell>
  );
}
