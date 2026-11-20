import { IconCheck, IconMinus } from '@jirawatpyk/aura-react/icons';
import type { Cell } from '@dxt/shared';

/**
 * One cell of the role matrix (`ROLE_MATRIX`, spec §14.9): a tick, a dash, or a tick with its limit.
 * Settings › Users and the User guide draw the same matrix.
 */
export function RoleMark({ cell }: { cell: Cell }) {
  if (cell === 'Y')
    return (
      <span className="text-fg-positive">
        <IconCheck size="sm" aria-label="Allowed" />
      </span>
    );
  if (cell === 'N')
    return (
      <span className="text-fg-tertiary">
        <IconMinus size="sm" aria-label="Not allowed" />
      </span>
    );
  return (
    <span className="inline-flex items-start gap-1.5 text-left">
      <span className="text-fg-secondary">
        <IconCheck size="sm" aria-label="Allowed with limits" />
      </span>
      <span className="text-xs leading-snug text-fg-secondary">{cell}</span>
    </span>
  );
}
