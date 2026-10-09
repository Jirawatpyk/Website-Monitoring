/** CSV for Site detail's downloads (today's check log, the 90-day incident history). */

/**
 * One CSV field: quoted when it holds a comma, quote or line break; a value a spreadsheet would run as
 * a formula (`=`, `+`, `-`, `@`, tab, CR) gets a leading `'` (CSV injection).
 */
export function csvField(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(
  header: readonly string[],
  rows: readonly (readonly (string | number | null)[])[],
): string {
  return [header, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

/** "Fuji Links" → "fuji-links" for a download's file name. */
export function fileSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'site'
  );
}

export function csvResponse(body: string, fileName: string): Response {
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'private, no-store',
    },
  });
}
