'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { SideNav } from '@jirawatpyk/aura-react';
import { activeNavId, NAV_SECTIONS } from './nav';

/** The main SideNav with the current page selected (the boards set `value`, e.g. "overview"). */
export function AppNav({ header, footer }: { header: ReactNode; footer: ReactNode }) {
  const value = activeNavId(usePathname()) ?? undefined;
  return (
    <SideNav sections={NAV_SECTIONS} value={value} header={header} footer={footer} label="Main navigation" />
  );
}
