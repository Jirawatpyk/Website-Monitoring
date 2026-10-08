'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { SideNav } from '@jirawatpyk/aura-react';
import { activeNavId, NAV_SECTIONS } from './nav';

interface AppNavProps {
  header: ReactNode;
  footer: ReactNode;
  /**
   * Set by AppShell on the copy in its phone drawer: it closes the drawer when an item (or Sign out) is
   * chosen. AppShell clones the `nav` element it gets — this wrapper — so they must reach SideNav.
   */
  onChange?: (id: string) => void;
  onAction?: (id: string) => void;
}

/** The main SideNav with the current page selected (the boards set `value`, e.g. "overview"). */
export function AppNav({ header, footer, onChange, onAction }: AppNavProps) {
  const value = activeNavId(usePathname()) ?? undefined;
  return (
    <SideNav
      sections={NAV_SECTIONS}
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
