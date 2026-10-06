import { Avatar } from '@jirawatpyk/aura-react';
import { BrandMark } from './brand';

/**
 * Phone top bar (MOverview, MobileAck): the brand on the left, the signed-in person's avatar on the
 * right, 16 px from the edge as on the boards (AppShell pads 8). AppShell puts it after its menu
 * button; the bar shows below lg only (`layout.tsx`, `globals.css`).
 * The back arrow on detail boards comes with the pages it returns to (Incidents, S07), and
 * BottomNav joins it in S06 for the four main sections; the menu drawer stays for the rest (D-018).
 */
export function MobileBar({ displayName }: { displayName: string }) {
  return (
    <div className="flex grow items-center justify-between pr-2">
      <BrandMark compact />
      <Avatar name={displayName} size="sm" />
    </div>
  );
}
