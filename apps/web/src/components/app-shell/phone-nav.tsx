'use client';

import { usePathname } from 'next/navigation';
import { BottomNav } from '@jirawatpyk/aura-react';
import { activeNavId, bottomNavWithCounts, type NavCounts } from './nav';

/**
 * The phone boards' BottomNav (D-018, D-031): the main sections below lg — phones and tablets — beside
 * the menu drawer, which still reaches every other page. Only live sections are listed (D-032), Incidents
 * with its open count. It slides away while scrolling down and comes back on the way up, at the top, or
 * when a keyboard reaches it (`hideOnScroll`, AURA 5.35 — request 14). A page with its own bottom bar (the
 * incident page) marks it `data-aura-hide-bottomnav`, and AURA keeps the BottomNav and its spacer away
 * while it is there.
 */
export function PhoneNav({ counts = {} }: { counts?: NavCounts }) {
  const pathname = usePathname();
  const value = activeNavId(pathname) ?? undefined;
  return (
    <BottomNav
      items={bottomNavWithCounts(counts)}
      value={value}
      label="Sections"
      hideFrom="lg"
      hideOnScroll
    />
  );
}
