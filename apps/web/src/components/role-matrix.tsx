'use client';

import { useState } from 'react';
import { Select } from '@jirawatpyk/aura-react';
import { MATRIX_ROLES, ROLE_LABELS, ROLE_MATRIX, roleRows, type MatrixRow, type Role } from '@dxt/shared';
import { RoleMark } from './role-mark';

/**
 * The role matrix on a phone (MUsers §35.4): a Role select over one role's rows — never a table that
 * scrolls sideways (§22.2). Settings › Users and the User guide's "Users & roles" topic use it.
 */
export function RoleMatrixPicker({
  rows = ROLE_MATRIX,
  roles = MATRIX_ROLES,
  className = '',
}: {
  rows?: readonly MatrixRow[];
  roles?: readonly Role[];
  className?: string;
}) {
  const [role, setRole] = useState<Role>('responder');
  const { rows: cells, foot } = roleRows(role, rows);
  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <Select
        label="Role"
        options={roles.map((r) => ({
          value: r,
          label: r === 'client' ? 'Client · Phase 3' : ROLE_LABELS[r],
        }))}
        value={role}
        onChange={(e) => setRole(e.target.value as Role)}
      />
      <div className="rounded-aura-lg border border-border-default bg-bg-surface px-3.5 py-1">
        {cells.map((r) => (
          <div
            key={r.label}
            className="flex gap-2.5 border-b border-border-subtle py-2.5 text-sm leading-snug last:border-b-0"
          >
            <RoleMark cell={r.cell} withLimit={false} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className={r.cell === 'N' ? 'text-fg-secondary' : ''}>{r.label}</span>
              {r.cell !== 'Y' && r.cell !== 'N' && (
                <span className="text-xs text-fg-secondary">{r.cell}</span>
              )}
            </span>
          </div>
        ))}
        <span className="block py-2 text-xs text-fg-secondary">{foot}</span>
      </div>
    </div>
  );
}
