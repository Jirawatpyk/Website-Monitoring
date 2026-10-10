import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { AppShell } from '@jirawatpyk/aura-react';
import { AppNav } from '@/components/app-shell/app-nav';
import { Brand } from '@/components/app-shell/brand';
import { MobileBar } from '@/components/app-shell/mobile-bar';
import { PhoneNav } from '@/components/app-shell/phone-nav';
import { OfflineStrip } from '@/components/states';
import { AccountFooter } from '@/features/auth';
import { countOpenIncidents } from '@/features/incidents/server';
import { countMonitoredSites } from '@/features/sites/server';
import { getAccess } from '@/lib/auth/session';

/**
 * Signed-in frame. The proxy already sent signed-out people to /login; a session without an active
 * profile (deactivated, or never on the access list) is signed out by /auth/refused (D-007).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  // Side by side: the counts are head counts under RLS, harmless (0 or null) for a session that then redirects.
  const [access, sites, incidents] = await Promise.all([
    getAccess(),
    countMonitoredSites(),
    countOpenIncidents(),
  ]);
  if (access.status === 'signed-out') redirect('/login');
  if (access.status !== 'active') redirect('/auth/refused');
  const { profile } = access;

  return (
    <AppShell
      // Top bar on phones only, as the phone boards draw it (D-018; AURA 5.33 `headerHideFrom`).
      headerHideFrom="lg"
      // …and slides away while scrolling down, back on the way up (AURA 5.35, request 13)
      headerHideOnScroll
      header={<MobileBar displayName={profile.displayName} />}
      nav={
        <AppNav
          header={<Brand />}
          footer={<AccountFooter displayName={profile.displayName} role={profile.role} />}
          counts={{ sites: sites ?? undefined, incidents: incidents ?? undefined }}
        />
      }
      // The phone boards' sections below lg (D-018, D-031); the menu drawer stays for the rest.
      bottomNav={<PhoneNav counts={{ incidents: incidents ?? undefined }} />}
    >
      <OfflineStrip />
      {children}
    </AppShell>
  );
}
