import type { ReactNode } from 'react';
import { Avatar } from '@jirawatpyk/aura-react';

/**
 * Phone top bar (spec §22.1, D-045): the page's part from the `@bar` slot (`PhoneBar`: back arrow, title or
 * brand, the page's own buttons), then the signed-in person's avatar, 16 px from the edge as on the boards
 * (AppShell pads 8). AppShell puts it after its menu button, which stays for the pages BottomNav doesn't
 * carry (D-018); the bar shows below lg only (`layout.tsx`).
 */
export function MobileBar({ displayName, children }: { displayName: string; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 grow items-center gap-1 pr-2">
      <div className="flex min-w-0 grow items-center gap-1">{children}</div>
      <Avatar name={displayName} size="sm" />
    </div>
  );
}
