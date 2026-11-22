import type { PdfModel } from '../words';

/**
 * The monthly PDF's page (board ReportPDF, A4) as one HTML string, printed by Chromium (D-073 item 1).
 * Every value from the database goes through `esc` — the only way text reaches the markup — and the
 * page carries no script; Chromium also runs with JavaScript off and the network blocked
 * (`render.ts`). Colours come from AURA's own stylesheet, inlined in `<head>` by `render.ts`
 * (`aura.css`, light theme), so nothing here is a value the app's tokens don't define.
 *
 * (Next 16 refuses `react-dom/server` in app code, so this is a template, not a React tree.)
 *
 * Page breaks (ReportPDF spec note): the header strip repeats on every page as the page table's
 * `<thead>` (so it uses the page's own fonts: Chromium's header template, a separate document, printed
 * a Thai client name as nothing on staging); the page numbers come from the footer template; an incident row never splits; the Incidents heading repeats
 * at the top of a continued list (a repeated table header).
 */

const STYLE = `
@page { size: A4; margin: 18mm 15mm 18mm; }
html, body { margin: 0; background: var(--aura-bg-surface); }
body { color: var(--aura-fg-primary); font-family: "Inter", "Noto Sans Thai", sans-serif; font-size: 12px; line-height: 1.55; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.mono { font-family: "Inter", "Noto Sans Thai", sans-serif; letter-spacing: 0.04em; }
header.top { display: flex; align-items: flex-start; justify-content: space-between; padding-bottom: 18px; border-bottom: 1px solid var(--aura-border-default); }
header.top .eyebrow { font-size: 10px; color: var(--aura-fg-secondary); }
h1 { margin: 6px 0; font-size: 32px; line-height: 1.1; font-weight: 600; letter-spacing: -0.01em; }
.meta { font-size: 12px; color: var(--aura-fg-secondary); }
.mark { height: 30px; padding: 0 10px; display: flex; align-items: center; gap: 6px; background: var(--aura-bg-surface-strong); color: var(--aura-fg-inverted); border-radius: var(--aura-radius-sm); font-size: 15px; font-weight: 600; }
.mark i { width: 6px; height: 6px; border-radius: 9999px; background: var(--aura-accent-dot); display: inline-block; }
.tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 22px 0; }
.tile { padding: 14px 16px; border: 1px solid var(--aura-border-default); border-radius: var(--aura-radius-md); display: flex; flex-direction: column; gap: 2px; line-height: 1.3; break-inside: avoid; }
.tile .k { font-size: 11px; color: var(--aura-fg-secondary); }
.tile .v { font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; }
.tile .c { font-size: 11px; color: var(--aura-fg-secondary); }
.tile .c.pos { color: var(--aura-fg-positive); font-weight: 500; }
h2 { margin: 0 0 10px; font-size: 15px; font-weight: 600; }
section { margin-bottom: 22px; }
.avail { break-inside: avoid; }
.row { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.row .name { width: 110px; flex-shrink: 0; font-weight: 500; overflow-wrap: anywhere; }
.row .pct { width: 56px; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
.cells { flex-grow: 1; display: grid; grid-template-columns: repeat(31, minmax(0, 1fr)); gap: 2px; }
.day { position: relative; display: flex; align-items: center; justify-content: center; box-sizing: border-box; height: 22px; border-radius: 3px; background: var(--aura-lime-500); color: var(--aura-zinc-0); font-size: 11px; font-weight: 600; line-height: 1; }
.day[data-k="degraded"] { background-color: var(--aura-amber-500); background-image: linear-gradient(135deg, var(--aura-zinc-900) 12%, transparent 12%, transparent 50%, var(--aura-zinc-900) 50%, var(--aura-zinc-900) 62%, transparent 62%); background-size: 5px 5px; }
.day[data-k="outage"] { background: var(--aura-red-600); }
.day[data-k="outage"]::after { content: "×"; font-size: 13px; }
.day[data-k="none"] { background: var(--aura-zinc-100); }
.day[data-m="1"] { box-shadow: inset 0 5px 0 0 var(--aura-fg-secondary); }
.day.sw { width: 10px; height: 10px; border-radius: 2px; display: inline-flex; }
.day.sw[data-m="1"] { box-shadow: inset 0 3px 0 0 var(--aura-fg-secondary); }
.day.sw[data-k="outage"]::after { font-size: 9px; }
.legend { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; padding-left: 122px; font-size: 10px; color: var(--aura-fg-secondary); }
.legend span { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.legend .end { margin-left: auto; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th h2 { text-transform: none; letter-spacing: 0; font-size: 15px; color: var(--aura-fg-primary); }
th { text-align: right; padding: 8px 0; border-bottom: 1px solid var(--aura-border-default); font-weight: 400; font-size: 10px; color: var(--aura-fg-secondary); text-transform: uppercase; letter-spacing: 0.04em; }
th:first-child, td:first-child { text-align: left; }
td { padding: 9px 0; border-bottom: 1px solid var(--aura-border-subtle); text-align: right; font-variant-numeric: tabular-nums; }
td:first-child { font-weight: 500; }
tr { break-inside: avoid; }
thead { display: table-header-group; }
.inc td { text-align: left; vertical-align: top; padding: 10px 12px 10px 0; }
.inc td:first-child { width: 76px; }
.inc td:nth-child(2) { width: 96px; }
.inc .sub { display: block; font-size: 11px; color: var(--aura-fg-secondary); font-weight: 400; }
.inc .kind { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; }
.inc .kind[data-k="outage"] { color: var(--aura-fg-danger); }
.inc .kind[data-k="degraded"] { color: var(--aura-alert-warning-fg); }
.inc .cause { display: block; color: var(--aura-fg-secondary); font-weight: 400; }
.empty { color: var(--aura-fg-secondary); }
table.page { width: 100%; border-collapse: collapse; }
table.page > thead > tr > td { padding: 0 0 10px; text-align: left; border: 0; }
table.page > tbody > tr > td { padding: 0; text-align: left; border: 0; font-variant-numeric: normal; }
.strip { display: flex; justify-content: space-between; font-size: 8px; color: var(--aura-fg-secondary); font-weight: 400; }
footer.measure { margin-top: 8px; padding-top: 14px; border-top: 1px solid var(--aura-border-default); font-size: 10px; line-height: 1.55; color: var(--aura-fg-secondary); break-inside: avoid; }
footer.measure b { color: var(--aura-fg-primary); }
footer.measure .id { display: block; margin-top: 8px; }
`;

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** HTML-escapes text and attribute values. */
export const esc = (s: string | number): string => String(s).replace(/[&<>"']/g, (c) => ENTITIES[c]!);

const swatch = (kind: string, maintenance = false) =>
  `<span class="day sw" data-k="${esc(kind)}" data-m="${maintenance ? '1' : '0'}"></span>`;

export function reportDocument(model: PdfModel, head: string): string {
  const tiles = model.tiles
    .map(
      (t) =>
        `<div class="tile"><span class="k">${esc(t.label)}</span><span class="v">${esc(t.value)}</span><span class="${t.positive ? 'c pos' : 'c'}">${esc(t.caption)}</span></div>`,
    )
    .join('');
  const sites = model.sites
    .map(
      (s) =>
        `<div class="row"><span class="name">${esc(s.name)}</span><div class="cells">${s.days
          .map(
            (d) =>
              `<span class="day" data-k="${esc(d.kind)}" data-m="${d.maintenance ? '1' : '0'}" aria-label="${esc(d.label)}"></span>`,
          )
          .join('')}</div><span class="pct">${esc(s.uptime)}</span></div>`,
    )
    .join('');
  const table = model.table
    .map(
      (r) =>
        `<tr><td>${esc(r.name)}</td><td>${esc(r.uptime)}</td><td>${esc(r.down)}</td><td>${esc(r.p50)}</td><td>${esc(r.p95)}</td><td>${esc(r.incidents)}</td></tr>`,
    )
    .join('');
  const incidents = model.incidents.length
    ? `<table class="inc"><thead><tr><th colspan="3"><h2>Incidents</h2></th></tr></thead><tbody>${model.incidents
        .map(
          (i) =>
            `<tr><td><b>${esc(i.date)}</b><span class="sub">${esc(i.time)}</span></td><td><span class="kind" data-k="${esc(i.kind)}">${swatch(i.kind)}${esc(i.kindWord)}</span><span class="sub">${esc(i.duration)}</span></td><td><b>${esc(i.line)}</b><span class="cause">${esc(i.cause)}</span></td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<h2>Incidents</h2><p class="empty">No outages or degraded service this month.</p>';

  return `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><title>${esc(model.title)}</title><style>${head}${STYLE}</style></head><body>
<table class="page"><thead><tr><td><div class="strip"><span>${esc(model.header)}</span><span>DxT</span></div></td></tr></thead><tbody><tr><td>
<header class="top"><div><div class="eyebrow mono">${esc(model.eyebrow)}</div><h1>${esc(model.client)}</h1><div class="meta">${esc(model.meta)}</div></div><div class="mark" aria-label="DxT">DxT <i></i></div></header>
<div class="tiles">${tiles}</div>
<section class="avail"><h2>Daily availability</h2>${sites}<div class="legend"><span>${swatch('ok')}Fully available</span><span>${swatch('degraded')}Degraded (site reachable)</span><span>${swatch('outage')}Outage</span><span>${swatch('ok', true)}Planned maintenance (not counted)</span><span class="end">Each day shows its worst event</span></div></section>
<section><h2>By website</h2><table><thead><tr><th>Website</th><th>Uptime</th><th>Downtime</th><th>Typical response</th><th>Slowest 5%</th><th>Incidents</th></tr></thead><tbody>${table}</tbody></table></section>
<section>${incidents}</section>
<footer class="measure"><b>How we measure.</b> ${esc(model.measure)}<span class="id mono">${esc(model.footer)}</span></footer>
</td></tr></tbody></table>
</body></html>`;
}
