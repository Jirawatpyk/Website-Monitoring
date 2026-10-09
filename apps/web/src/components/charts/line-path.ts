/** A point of a time series; `v` null = no value (the line breaks there). */
export interface SeriesPoint {
  t: number;
  v: number | null;
}

/**
 * The SVG path of one series in a `width` × `height` box: time runs left to right from `from` to `to`,
 * values bottom (0) to top (`max`). A null value ends the current segment, so a failed bucket is a gap.
 */
export function linePath(
  points: readonly SeriesPoint[],
  { from, to, max, width, height }: { from: number; to: number; max: number; width: number; height: number },
): string {
  const span = Math.max(1, to - from);
  const out: string[] = [];
  let pen = false;
  for (const p of points) {
    if (p.v === null || p.t < from || p.t > to) {
      pen = false;
      continue;
    }
    const x = ((p.t - from) / span) * width;
    const y = height - (Math.min(p.v, max) / max) * height;
    out.push(`${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`);
    pen = true;
  }
  return out.join(' ');
}

/** A round axis top above the largest value: 250, 500, 1000, 2000, 2500, 5000 … (never below 250 ms). */
export function niceMax(values: readonly (number | null)[]): number {
  const top = Math.max(0, ...values.filter((v): v is number => v !== null));
  const steps = [1, 2, 2.5, 5, 10];
  let unit = 100;
  while (unit * 10 < top) unit *= 10;
  for (const s of steps) if (unit * s >= top && unit * s >= 250) return unit * s;
  return unit * 10;
}
