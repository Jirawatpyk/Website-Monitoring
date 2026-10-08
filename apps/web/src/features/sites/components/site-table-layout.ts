/**
 * The Sites table's column widths (the Sites board) and the table widths at which the optional columns
 * appear, worked out from them — so a changed width can't make the table scroll sideways in a band
 * nobody measured (S05c /verify). DataTable's flexible column (Site) never shrinks below 160 px
 * (`minWidth` only limits resizing), so the columns shown at a width must fit beside it.
 */

export const COLUMN_WIDTH = {
  status: 144,
  tier: 40,
  owner: 136,
  locations: 92,
  p50: 104,
  uptime: 96,
  expiry: 64,
  // the table's mono face is wider than the board's 12 px: 72 px broke HH:MM:SS onto two lines (Tao)
  checked: 80,
  actions: 156,
} as const;
type Column = keyof typeof COLUMN_WIDTH;

/** DataTable's floor for the flexible column. */
export const FLEX_MIN = 160;
/** The row's start and end gutters (24 px each). */
export const GUTTERS = 48;
/** The narrowest table: the md viewport (768) less the page's 24 px margins and the table's 1 px frame
 * (measured: 820 → 770) — the table shows from md. */
export const NARROWEST_TABLE = 718;

/** Always shown; Checked from `CHECKED_FROM`; from a 1024 px table (`'lg'`); from `LATE_FROM`. */
export const ALWAYS: readonly Column[] = ['status', 'tier', 'locations', 'actions'];
export const CHECKED: readonly Column[] = ['checked'];
export const FROM_LG: readonly Column[] = ['owner', 'uptime'];
export const LATE: readonly Column[] = ['p50', 'expiry'];

const LG = 1024;

/** The table width the given columns need beside the flexible one. */
export function needs(columns: readonly Column[]): number {
  return GUTTERS + FLEX_MIN + columns.reduce((sum, c) => sum + COLUMN_WIDTH[c], 0);
}

/** Checked shows once it fits beside the always-shown columns (720 px: hidden only at the md edge). */
export const CHECKED_FROM = needs([...ALWAYS, ...CHECKED]);

/** Response 24h and Expiry show once every column fits (1120 px with the board's widths). */
export const LATE_FROM = Math.max(LG, needs([...ALWAYS, ...CHECKED, ...FROM_LG, ...LATE]));
