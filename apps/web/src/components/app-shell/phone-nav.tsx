'use client';

import { usePathname } from 'next/navigation';
import { BottomNav } from '@jirawatpyk/aura-react';
import { activeNavId, BOTTOM_NAV_ITEMS } from './nav';

/**
 * The phone boards' BottomNav (D-018, D-031): the main sections below lg — phones and tablets — beside
 * the menu drawer, which still reaches every other page. Only live sections are listed (D-032).
 */
export function PhoneNav() {
  const value = activeNavId(usePathname()) ?? undefined;
  return <BottomNav items={BOTTOM_NAV_ITEMS} value={value} label="Sections" hideFrom="lg" />;
}
