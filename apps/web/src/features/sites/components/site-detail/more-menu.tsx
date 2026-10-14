'use client';

import { Button, DropdownMenu, IconButton, type MenuItem } from '@jirawatpyk/aura-react';
import { IconEllipsis, IconExternalLink, IconPencil } from '@jirawatpyk/aura-react/icons';

/**
 * Site detail's ⋯ (spec §25, D-043). From md: a 44 px secondary icon button last in the header actions, with
 * Edit site for an Admin and Visit site for everyone. Phones: a borderless 44 px ⋯ at the end of the breadcrumb
 * row with Visit site only, until Edit site is view only there (§22.5). Nothing to offer → no button.
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
    ...(canEdit && !phone
      ? [{ label: 'Edit site', icon: <IconPencil />, href: `/sites/${siteId}/edit` }]
      : []),
    ...(url ? [{ label: 'Visit site', icon: <IconExternalLink />, href: url, target: '_blank' }] : []),
  ];
  if (!items.length) return null;
  const label = `More actions for ${name}`;
  return (
    <DropdownMenu
      label={label}
      trigger={
        phone ? (
          <IconButton icon={<IconEllipsis />} label={label} size="md" className="size-11" />
        ) : (
          // A secondary Button as the board draws it (IconButton has no border); its name is the hidden text.
          <Button variant="secondary" icon={<IconEllipsis />} className="w-11 justify-center gap-0 px-0">
            <span className="sr-only">{label}</span>
          </Button>
        )
      }
      items={items}
    />
  );
}
