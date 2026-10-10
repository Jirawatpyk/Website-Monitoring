/**
 * The Incidents table's column widths and the table widths each optional column appears from, worked
 * out from the widths as in Sites (`site-table-layout.ts`, S05c) — so the table never scrolls sideways
 * at a width nobody measured. Site is DataTable's flexible column, never below its 160 px floor.
 */
const FLEX_MIN = 160;
/** The row's start and end gutters (24 px each). */
const GUTTERS = 48;
/** The narrowest table: the md viewport less the page margins, frame and a scrollbar (as Sites). */
export const NARROWEST_TABLE = 703;

const WIDTH = {
  id: 88,
  severity: 128,
  state: 200,
  // "Yesterday 06:04" / "Wed 7 Oct 06:04" on one line (120 wrapped them)
  started: 144,
  duration: 88,
  trigger: 128,
} as const;
type Column = keyof typeof WIDTH;

/** Always shown, then the optional ones in the order they join as the table grows. */
const ALWAYS: readonly Column[] = ['id', 'severity', 'state'];
const OPTIONAL: readonly Column[] = ['started', 'duration', 'trigger'];

/** The table width the given columns need beside the flexible one. */
export const needs = (columns: readonly Column[]) =>
  GUTTERS + FLEX_MIN + columns.reduce((sum, c) => sum + WIDTH[c], 0);

export const INCIDENT_COLUMNS = Object.fromEntries(
  (Object.keys(WIDTH) as Column[]).map((c) => {
    const at = OPTIONAL.indexOf(c);
    return [
      c,
      { width: WIDTH[c], from: at < 0 ? undefined : needs([...ALWAYS, ...OPTIONAL.slice(0, at + 1)]) },
    ];
  }),
) as Record<Column, { width: number; from: number | undefined }>;

export const ALWAYS_NEEDS = needs(ALWAYS);
