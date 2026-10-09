import { linePath, niceMax, type SeriesPoint } from './line-path';

/** One line: a `--aura-chart-N` token for its colour (AURA's chart palette). */
export interface ChartSeries {
  label: string;
  color: `--aura-chart-${number}`;
  points: readonly SeriesPoint[];
}

const W = 600;
const H = 200;
const GRID = [1, 0.75, 0.5, 0.25, 0];

/**
 * A small multi-line chart (AURA has no line chart): time on x, a value from 0 on y, gaps where a
 * series has no value. Server-rendered SVG that stretches to its box; the y labels and the x labels are
 * HTML so they keep their size. `label` names it for screen readers (the lines are decoration).
 */
export function LineChart({
  series,
  from,
  to,
  xLabels,
  label,
  formatY = (v) => String(v),
  heightClass = 'h-56',
}: {
  series: readonly ChartSeries[];
  from: number;
  to: number;
  xLabels: readonly string[];
  label: string;
  formatY?: (v: number) => string;
  /** Tailwind height of the plot area, e.g. `h-56` desktop, `h-20` phone. */
  heightClass?: string;
}) {
  const max = niceMax(series.flatMap((s) => s.points.map((p) => p.v)));
  return (
    <figure className="m-0 flex flex-col gap-1" aria-label={label} role="img">
      <div className="flex gap-2">
        <div
          className={`${heightClass} flex shrink-0 flex-col justify-between text-right font-mono text-xs leading-none text-chart-axis`}
          aria-hidden
        >
          {GRID.map((g) => (
            <span key={g}>{formatY(Math.round(max * g))}</span>
          ))}
        </div>
        <svg
          className={`${heightClass} min-w-0 grow overflow-visible`}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          aria-hidden
        >
          {GRID.map((g) => (
            <line
              key={g}
              x1={0}
              x2={W}
              y1={H - g * H}
              y2={H - g * H}
              vectorEffect="non-scaling-stroke"
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
          <span key={`${l}-${i}`}>{l}</span>
        ))}
      </div>
    </figure>
  );
}

/** The legend swatch for a series (a short line in its colour). */
export function SeriesKey({ series }: { series: ChartSeries }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-0.5 w-3" style={{ background: `var(${series.color})` }} aria-hidden />
      {series.label}
    </span>
  );
}
