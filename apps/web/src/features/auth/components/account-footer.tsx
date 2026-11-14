import { Avatar, IconButton } from '@jirawatpyk/aura-react';
import { IconLogOut } from '@jirawatpyk/aura-react/icons';
import { ROLE_LABELS, type Role } from '@dxt/shared';
import Link from 'next/link';
import { signOut } from '../actions';

interface AccountFooterProps {
  displayName: string;
  role: Role;
}

/**
 * SideNav footer: who is signed in, their role, and Sign out (canvas sidebar footer). Sign out is an
 * icon button (accessible name + tooltip) so the name and role keep the width; a long name wraps
 * onto two lines. The SideNav footer supplies the padding.
 */
export function AccountFooter({ displayName, role }: AccountFooterProps) {
  return (
    <div className="flex items-center gap-3">
      {/* Name and avatar open My profile (Profile board's account footer, S16 PR 3). */}
      <Link
        href="/profile"
        aria-label={`My profile: ${displayName}, ${ROLE_LABELS[role]}`}
        className="flex min-h-11 min-w-0 grow items-center gap-3 rounded-aura-md text-fg-primary no-underline"
      >
        <span aria-hidden>
          <Avatar name={displayName} size="md" />
        </span>
        <span className="flex min-w-0 grow flex-col">
          <span className="line-clamp-2 text-sm font-medium break-words">{displayName}</span>
          <span className="truncate text-xs text-fg-secondary">{ROLE_LABELS[role]}</span>
        </span>
      </Link>
      <form action={signOut}>
        {/* AURA IconButton: `label` is its accessible name and its tooltip (AURA sets `title`). */}
        <IconButton type="submit" icon={<IconLogOut />} label="Sign out" touchHeight />
      </form>
    </div>
  );
}
