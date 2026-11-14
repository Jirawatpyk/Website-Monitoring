import { Badge } from '@jirawatpyk/aura-react';
import { ROLE_LABELS, type Role } from '@dxt/shared';

const VARIANT: Record<Role, 'solid' | 'soft' | 'outline'> = {
  admin: 'solid',
  responder: 'soft',
  stakeholder: 'outline',
  viewer: 'soft',
  client: 'outline',
};

/** A role as the Users boards draw it: neutral, Admin solid, Stakeholder outline (§11: no colour for roles). */
export function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge tone="neutral" variant={VARIANT[role]}>
      {ROLE_LABELS[role]}
    </Badge>
  );
}
