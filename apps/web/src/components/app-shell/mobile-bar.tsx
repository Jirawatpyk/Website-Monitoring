'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Avatar } from '@jirawatpyk/aura-react';
import { IconArrowLeft } from '@jirawatpyk/aura-react/icons';
import { BrandMark } from './brand';

/** Detail pages whose phone board draws a back arrow, and where it leads (D-018). */
const BACK: { match: RegExp; href: string; label: string }[] = [
  // MobileAck, MIncident → Incidents (S07)
  { match: /^\/incidents\/[^/]+$/, href: '/incidents', label: 'Back to incidents' },
];

/**
 * Phone top bar (MOverview, MobileAck, MIncident): the brand on the left — after a back arrow on a
 * detail page — and the signed-in person's avatar on the right, 16 px from the edge as on the boards
 * (AppShell pads 8). AppShell puts it after its menu button; the bar shows below lg only (`layout.tsx`,
 * `globals.css`). BottomNav (`phone-nav.tsx`, S06b) carries the main sections; the menu drawer stays
 * for the rest (D-018, D-031).
 */
export function MobileBar({ displayName }: { displayName: string }) {
  const pathname = usePathname() ?? '';
  const back = BACK.find((b) => b.match.test(pathname));
  return (
    <div className="flex grow items-center justify-between pr-2">
      <span className="flex items-center gap-1">
        {back && (
          <Link
            href={back.href}
            aria-label={back.label}
            className="flex size-11 items-center justify-center rounded-aura-md text-fg-primary hover:bg-bg-surface-hover"
          >
            <IconArrowLeft aria-hidden className="size-5" />
          </Link>
        )}
        <BrandMark compact />
      </span>
      <Avatar name={displayName} size="sm" />
    </div>
  );
}
