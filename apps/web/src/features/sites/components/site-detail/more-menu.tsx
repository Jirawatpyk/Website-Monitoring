'use client';

import { Button, DropdownMenu, IconButton, type MenuItem } from '@jirawatpyk/aura-react';
import { IconEllipsis, IconExternalLink, IconPencil } from '@jirawatpyk/aura-react/icons';

/**
 * Site detail's ⋯ (spec §25, D-043, D-044): Edit site for an Admin and Visit site for everyone. From md a 44 px
 * secondary icon button last in the header actions; below lg a borderless 44 px ⋯ in the phone top bar (D-045).
 * Edit site stays editable on phones (D-044), so the phone menu has no "View only on phones" line. Nothing to
 * offer → no button.
 */
export function SiteMoreMenu({
  siteId,
  name,
  url,
  canEdit,
  phone = false,
}: {
  siteId: string;
  name: string;
  url: string | null;
  canEdit: boolean;
  phone?: boolean;
}) {
  const items: MenuItem[] = [
    ...(canEdit ? [{ label: 'Edit site', icon: <IconPencil />, href: `/sites/${siteId}/edit` }] : []),
    ...(url ? [{ label: 'Visit site', icon: <IconExternalLink />, href: url, target: '_blank' }] : []),
  ];
  if (!items.length) return null;
  const label = `More actions for ${name}`;
  return (
    <DropdownMenu
      label={label}
      trigger={
        phone ? (
          <IconButton
            icon={<IconEllipsis />}
            label={label}
            size="md"
            className="size-11 aria-expanded:bg-bg-surface-hover"
          />
        ) : (
          // A secondary Button as the board draws it (IconButton has no border); its name is the hidden text.
          <Button
            variant="secondary"
            icon={<IconEllipsis />}
            title={label}
            className="w-11 justify-center gap-0 px-0"
          >
            <span className="sr-only">{label}</span>
          </Button>
        )
      }
      items={items}
    />
  );
}
