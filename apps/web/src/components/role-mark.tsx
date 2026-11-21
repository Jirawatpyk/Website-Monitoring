import { IconCheck, IconMinus } from '@jirawatpyk/aura-react/icons';
import type { Cell } from '@dxt/shared';

/**
 * One cell of the role matrix (`ROLE_MATRIX`, spec §14.9): a tick, a dash, or a tick with its limit.
 * Settings › Users and the User guide draw the same matrix. AURA icons take their accessible name from
 * `label` (an `aria-label` is dropped and the icon stays hidden — spec-checker, S18).
 * `withLimit={false}` leaves the limit's words to the caller (the phone list prints them below).
 */
export function RoleMark({ cell, withLimit = true }: { cell: Cell; withLimit?: boolean }) {
  if (cell === 'Y')
    return (
      <span className="text-fg-positive">
        <IconCheck size="sm" label="Allowed" />
      </span>
    );
  if (cell === 'N')
    return (
      <span className="text-fg-tertiary">
        <IconMinus size="sm" label="Not allowed" />
      </span>
    );
  return (
    <span className="inline-flex items-start gap-1.5 text-left">
      <span className="text-fg-secondary">
        <IconCheck size="sm" label="Allowed with limits" />
      </span>
      {withLimit && <span className="text-xs leading-snug text-fg-secondary">{cell}</span>}
    </span>
  );
}
