'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { AuraProvider, Toaster } from '@jirawatpyk/aura-react';

/** AuraProvider needs next/link (a function), so it lives in a client file the root layout renders. UI is English (PRD §9). */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuraProvider locale="en" linkComponent={Link}>
      {children}
      <Toaster />
    </AuraProvider>
  );
}
