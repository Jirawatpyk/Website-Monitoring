import { linePath, niceMax, type SeriesPoint } from './line-path';

/** One line: a `--aura-chart-N` token for its colour (AURA's chart palette). */
export interface ChartSeries {
  label: string;
  /** A shorter label for phones ("BKK" for "BKK · Thai VPS"). */
  shortLabel?: string;
  color: `--aura-chart-${number}`;
  points: readonly SeriesPoint[];
}

const W = 600;
const H = 200;
/** Grid lines top to bottom; the in-between ones drop their labels on phones (fewer, readable). */
const GRID = [
  { at: 1, phone: true },
  { at: 0.75, phone: false },
  { at: 0.5, phone: true },
  { at: 0.25, phone: false },
  { at: 0, phone: true },
];

/**
 * A small multi-line chart (AURA has no line chart): time on x, a value from 0 on y, gaps where a
 * series has no value. Server-rendered SVG that stretches to its box; labels are HTML so they keep
 * their size. Below md it is shorter, with three y labels and only the first x label and "now".
 * `label` names it for screen readers (the lines are decoration). No points at all → `empty`.
 */
export function LineChart({
  series,
  from,
  to,
  xLabels,
  label,
  empty,
  formatY = (v) => String(v),
}: {
  series: readonly ChartSeries[];
  from: number;
  to: number;
  xLabels: readonly string[];
  label: string;
  /** What to say instead of an empty plot ("No checks in this range yet"). */
  empty: string;
  formatY?: (v: number) => string;
}) {
  const values = series.flatMap((s) => s.points.map((p) => p.v));
  if (values.every((v) => v === null)) {
    return <p className="m-0 py-8 text-center text-sm text-fg-secondary">{empty}</p>;
  }
  const max = niceMax(values);
  const height = 'h-20 md:h-56';
  return (
    <figure className="m-0 flex flex-col gap-1" aria-label={label} role="img">
      <div className="flex gap-2">
        <div
          className={`${height} flex shrink-0 flex-col justify-between text-right font-mono text-xs leading-none text-chart-axis`}
          aria-hidden
        >
          {GRID.map((g) => (
            <span key={g.at} className={g.phone ? undefined : 'max-md:hidden'}>
              {formatY(Math.round(max * g.at))}
            </span>
          ))}
        </div>
        <svg
          className={`${height} min-w-0 grow overflow-visible`}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          aria-hidden
        >
          {GRID.map((g) => (
            <line
              key={g.at}
              x1={0}
              x2={W}
              y1={H - g.at * H}
              y2={H - g.at * H}
              vectorEffect="non-scaling-stroke"
              className={g.phone ? undefined : 'max-md:hidden'}
              style={{ stroke: 'var(--aura-chart-grid)' }}
            />
          ))}
          {series.map((s) => (
            <path
              key={s.label}
              d={linePath(s.points, { from, to, max, width: W, height: H })}
              fill="none"
              strokeWidth={1.75}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              style={{ stroke: `var(${s.color})` }}
            />
          ))}
        </svg>
      </div>
      <div className="flex justify-between pl-10 font-mono text-xs text-chart-axis" aria-hidden>
        {xLabels.map((l, i) => (
          <span
            key={`${l}-${i}`}
            className={i === 0 || i === xLabels.length - 1 ? undefined : 'max-md:hidden'}
          >
            {l}
          </span>
        ))}
      </div>
    </figure>
  );
}

/** The legend swatch for a series (a short line in its colour); the short label on phones. */
export function SeriesKey({ series }: { series: ChartSeries }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-0.5 w-3" style={{ background: `var(${series.color})` }} aria-hidden />
      {series.shortLabel ? (
        <>
          <span className="md:hidden">{series.shortLabel}</span>
          <span className="max-md:hidden">{series.label}</span>
        </>
      ) : (
        series.label
      )}
    </span>
  );
}
