'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { SideNav } from '@jirawatpyk/aura-react';
import { activeNavId, navSectionsWithCounts, type NavCounts } from './nav';

interface AppNavProps {
  header: ReactNode;
  footer: ReactNode;
  counts?: NavCounts;
  /**
   * Set by AppShell on the copy in its phone drawer: it closes the drawer when an item (or Sign out) is
   * chosen. AppShell clones the `nav` element it gets — this wrapper — so they must reach SideNav.
   */
  onChange?: (id: string) => void;
  onAction?: (id: string) => void;
}

/** The main SideNav with the current page selected (the boards set `value`, e.g. "overview"). */
export function AppNav({ header, footer, counts = {}, onChange, onAction }: AppNavProps) {
  const value = activeNavId(usePathname()) ?? undefined;
  return (
    <SideNav
      sections={navSectionsWithCounts(counts)}
      value={value}
      header={header}
      headerDivider
      footer={footer}
      label="Main navigation"
      onChange={onChange}
      onAction={onAction}
    />
  );
}
