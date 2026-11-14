import type { Role } from './domain';

/**
 * The role matrix (Users / MUsers boards, spec §14.9) and what a role change adds and takes away —
 * one diff for the Users dialog's GAINS / LOSES (short labels) and the role-change email's
 * YOU CAN NOW / YOU CAN NO LONGER / YOU KEEP (sentences, spec §34, D-062 item 13).
 */

/** 'Y' allowed, 'N' not, anything else: allowed with that limit. Columns: admin … viewer, client. */
export type Cell = 'Y' | 'N' | string;

export const MATRIX_ROLES = [
  'admin',
  'responder',
  'stakeholder',
  'viewer',
  'client',
] as const satisfies readonly Role[];

const OWN_SITES = 'Own sites';
const OWN_CLIENTS = 'Own clients';
const ACK_RESPONDER = 'Own sites (owner or backup) + Tier 1 when on call';

export interface MatrixRow {
  label: string;
  cells: readonly [Cell, Cell, Cell, Cell, Cell];
  /** The email's words. `can` / `lose` by the cell gained or lost; `narrow` by the narrower cell kept. */
  email: {
    keep: string;
    can: Readonly<Record<string, string>>;
    lose: Readonly<Record<string, string>>;
    narrow?: Readonly<Record<string, string>>;
  };
}

export const ROLE_MATRIX: readonly MatrixRow[] = [
  {
    label: 'See dashboard and history',
    cells: ['Y', 'Y', 'Y', 'Y', 'Own sites'],
    email: {
      keep: 'the dashboard and history',
      can: { Y: 'See the dashboard and history' },
      lose: { Y: 'See the dashboard and history' },
    },
  },
  {
    label: 'Receive alerts and digests',
    cells: ['Y', 'Y', 'Y', 'N', 'N'],
    email: {
      keep: 'alerts and digests',
      can: { Y: 'Receive alerts and digests' },
      lose: { Y: 'Receive alerts and digests' },
    },
  },
  {
    label: 'Acknowledge and resolve incidents',
    cells: ['Y', ACK_RESPONDER, 'N', 'N', 'N'],
    email: {
      keep: 'acknowledging and resolving incidents',
      can: {
        Y: 'Acknowledge and resolve incidents on every site',
        [ACK_RESPONDER]:
          'Acknowledge and resolve incidents on your sites, and on Tier 1 sites while you’re on call',
      },
      lose: {
        Y: 'Acknowledge or resolve incidents',
        [ACK_RESPONDER]: 'Acknowledge or resolve incidents on your sites',
      },
      narrow: {
        [ACK_RESPONDER]:
          'Acknowledge or resolve incidents, except on your sites and on Tier 1 sites while you’re on call',
      },
    },
  },
  {
    label: 'Mark client update / Not needed',
    cells: ['Y', OWN_SITES, OWN_CLIENTS, 'N', 'N'],
    email: {
      keep: 'client updates',
      can: {
        Y: 'Mark client updates on every site',
        [OWN_SITES]: 'Mark client updates on your sites',
        [OWN_CLIENTS]: 'Mark client updates for clients where you’re Site AM',
      },
      lose: {
        Y: 'Mark client updates',
        [OWN_SITES]: 'Mark client updates on your sites',
        [OWN_CLIENTS]: 'Mark client updates for clients where you’re Site AM',
      },
      narrow: {
        [OWN_SITES]: 'Mark client updates, except on your sites',
        [OWN_CLIENTS]: 'Mark client updates, except for clients where you’re Site AM',
      },
    },
  },
  {
    label: 'Maintenance windows and mute',
    cells: ['Y', OWN_SITES, 'N', 'N', 'N'],
    email: {
      keep: 'maintenance and mutes',
      can: {
        Y: 'Schedule maintenance and mute any site',
        [OWN_SITES]: 'Schedule maintenance and mute your sites',
      },
      lose: {
        Y: 'Schedule maintenance or mute sites',
        [OWN_SITES]: 'Schedule maintenance or mute your sites',
      },
      narrow: { [OWN_SITES]: 'Schedule maintenance or mute sites, except your own' },
    },
  },
  {
    label: 'Download uptime reports',
    cells: ['Y', 'Y', 'Y', 'N', 'Own sites'],
    email: {
      keep: 'uptime reports',
      can: { Y: 'Download uptime reports' },
      lose: { Y: 'Download uptime reports' },
    },
  },
  {
    label: 'Send client reports / edit AM note',
    cells: ['Y', 'N', OWN_CLIENTS, 'N', 'N'],
    email: {
      keep: 'client reports',
      can: {
        Y: 'Send client reports and edit the AM note',
        [OWN_CLIENTS]: 'Send client reports for clients where you’re Site AM',
      },
      lose: {
        Y: 'Send client reports or edit the AM note',
        [OWN_CLIENTS]: 'Send client reports for clients where you’re Site AM',
      },
      narrow: { [OWN_CLIENTS]: 'Send client reports, except for clients where you’re Site AM' },
    },
  },
  {
    label: 'Approve incident review',
    cells: ['Y', 'N', 'N', 'N', 'N'],
    email: {
      keep: 'incident reviews',
      can: { Y: 'Approve incident reviews' },
      lose: { Y: 'Approve incident reviews' },
    },
  },
  {
    label: 'Edit sites, monitors and escalation',
    cells: ['Y', 'N', 'N', 'N', 'N'],
    email: {
      keep: 'editing sites',
      can: { Y: 'Edit sites, monitors and escalation' },
      lose: { Y: 'Edit sites, monitors or escalation' },
    },
  },
  {
    label: 'Manage users and roles',
    cells: ['Y', 'N', 'N', 'N', 'N'],
    email: {
      keep: 'users and roles',
      can: { Y: 'Manage users and roles' },
      lose: { Y: 'Manage users or roles' },
    },
  },
];

const col = (r: Role) => MATRIX_ROLES.indexOf(r as (typeof MATRIX_ROLES)[number]);

/** What one row does in a change from `from` to `to`. */
type Change = 'gain' | 'lose' | 'widen' | 'narrow' | 'keep' | 'none';

function changeOf(x: Cell, y: Cell): Change {
  if (x === 'N' && y === 'N') return 'none';
  if (x === y) return 'keep';
  if (x === 'N') return 'gain';
  if (y === 'N') return 'lose';
  if (y === 'Y') return 'widen';
  return 'narrow';
}

const cells = (r: MatrixRow, from: Role, to: Role) =>
  [r.cells[col(from)] ?? 'N', r.cells[col(to)] ?? 'N'] as const;

/** What a role change adds and takes away (the Users dialog's GAINS / LOSES), in the board's words. */
export function gainsLoses(from: Role, to: Role): { gains: string[]; loses: string[] } {
  const gains: string[] = [];
  const loses: string[] = [];
  for (const r of ROLE_MATRIX) {
    const [x, y] = cells(r, from, to);
    switch (changeOf(x, y)) {
      case 'gain':
        gains.push(y === 'Y' ? r.label : `${r.label} (${y.toLowerCase()})`);
        break;
      case 'lose':
        loses.push(r.label);
        break;
      case 'widen':
        gains.push(`${r.label} (all sites)`);
        break;
      case 'narrow':
        loses.push(`${r.label} outside ${y.toLowerCase()}`);
        break;
    }
  }
  return { gains, loses };
}

export interface RoleDiff {
  /** YOU CAN NOW */
  now: string[];
  /** YOU CAN NO LONGER */
  noLonger: string[];
  /** YOU KEEP — one sentence, or null when nothing is kept. */
  keep: string | null;
}

/**
 * The role-change email's lists (spec §34). `managesClients`: the person is Site AM of a client after
 * the change; a right limited to own clients then reads "(none yet)" when they manage none.
 */
export function roleDiff(from: Role, to: Role, opts: { managesClients: boolean }): RoleDiff {
  const now: string[] = [];
  const noLonger: string[] = [];
  const kept: string[] = [];
  const word = (m: Readonly<Record<string, string>> | undefined, cell: Cell, r: MatrixRow) => {
    const w = m?.[cell];
    if (!w) throw new Error(`roleDiff: no words for “${r.label}” · ${cell}`);
    return w;
  };
  for (const r of ROLE_MATRIX) {
    const [x, y] = cells(r, from, to);
    switch (changeOf(x, y)) {
      case 'gain':
      case 'widen': {
        const w = word(r.email.can, y, r);
        now.push(y === OWN_CLIENTS && !opts.managesClients ? `${w} (none yet)` : w);
        break;
      }
      case 'lose':
        noLonger.push(word(r.email.lose, x, r));
        break;
      case 'narrow':
        noLonger.push(word(r.email.narrow, y, r));
        break;
      case 'keep':
        kept.push(r.email.keep);
        break;
    }
  }
  const keep = kept.length ? `${kept.join(', ')}`.replace(/^./, (c) => c.toUpperCase()) : null;
  return { now, noLonger, keep };
}
