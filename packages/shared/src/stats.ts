/**
 * The value in the middle of the weights; null values and empty weights are skipped. Site detail's
 * range figures and the monthly report's "Typical response" / "Slowest 5%" use it on daily rollups
 * weighted by their checks, so the two agree for the same days (D-073 item 10).
 */
export function weightedMedian(pairs: readonly (readonly [number | null, number])[]): number | null {
  const v = pairs.filter((p): p is [number, number] => p[0] !== null && p[1] > 0).sort((a, b) => a[0] - b[0]);
  const total = v.reduce((s, p) => s + p[1], 0);
  if (total === 0) return null;
  let run = 0;
  for (const [value, w] of v) {
    run += w;
    if (run >= total / 2) return value;
  }
  return v.at(-1)![0];
}
