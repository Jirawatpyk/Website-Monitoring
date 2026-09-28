import type { ReactNode } from 'react';
import { AppShell, SideNav } from '@jirawatpyk/aura-react';
import { Brand } from '@/components/app-shell/brand';
import { NAV_SECTIONS } from '@/components/app-shell/nav';

/** Signed-in frame. The proxy already sent signed-out people to /login. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell nav={<SideNav sections={NAV_SECTIONS} header={<Brand />} label="Main navigation" />}>
      {children}
    </AppShell>
  );
}
