import { Avatar, Button } from '@jirawatpyk/aura-react';
import { IconLogOut } from '@jirawatpyk/aura-react/icons';
import { ROLE_LABELS, type Role } from '@dxt/shared';
import { signOut } from '../actions';

interface AccountFooterProps {
  displayName: string;
  role: Role;
}

/** SideNav footer: who is signed in, their role, and Sign out (canvas sidebar footer). */
export function AccountFooter({ displayName, role }: AccountFooterProps) {
  return (
    <div className="flex items-center gap-3 border-t border-border-default px-4 py-3">
      <span aria-hidden>
        <Avatar name={displayName} size="md" />
      </span>
      <div className="flex min-w-0 grow flex-col">
        <span className="truncate text-sm font-medium">{displayName}</span>
        <span className="truncate text-xs text-fg-secondary">{ROLE_LABELS[role]}</span>
      </div>
      <form action={signOut}>
        <Button type="submit" variant="ghost" size="sm" touchHeight icon={<IconLogOut />}>
          Sign out
        </Button>
      </form>
    </div>
  );
}
