import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PdfModel } from '../words';
import { reportDocument } from './document';

/**
 * Prints the monthly report to an A4 PDF with headless Chromium (D-073 item 1). On Vercel the binary
 * is `@sparticuz/chromium`; locally Playwright's own Chromium (`pnpm exec playwright install chromium`).
 *
 * Safety (security review, S20): every string reaches the page escaped (`esc` in document.ts); JavaScript is
 * off; every request but a `data:` URL is aborted, so a client name or root-cause text can never make
 * the renderer fetch anything; the fonts and AURA's stylesheet are inlined from the app's own files.
 */

const AURA_DIR = path.join(process.cwd(), 'node_modules', '@jirawatpyk', 'aura-tokens');
const FONTS = [
  ['Inter', 'inter-latin-wght-normal.woff2', '100 900'],
  ['Inter', 'inter-latin-ext-wght-normal.woff2', '100 900'],
  ['Noto Sans Thai', 'noto-sans-thai-thai-wght-normal.woff2', '100 900'],
  // AURA's display and mono faces, as the board (D-073 item 1 as amended)
  ['Fraunces', 'fraunces-latin-opsz-normal.woff2', '100 900'],
  ['JetBrains Mono', 'jetbrains-mono-latin-400-normal.woff2', '400'],
] as const;

let headCache: Promise<string> | null = null;

/** AURA's light tokens and the fonts as `data:` URLs — read once per instance. */
function head(): Promise<string> {
  headCache ??= (async () => {
    const css = await readFile(path.join(AURA_DIR, 'aura.css'), 'utf8');
    const faces = await Promise.all(
      FONTS.map(async ([family, file, weight]) => {
        const b64 = (await readFile(path.join(AURA_DIR, 'fonts', file))).toString('base64');
        return `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${b64}) format("woff2");}`;
      }),
    );
    // the dark block only applies under prefers-color-scheme: dark, which print never emulates
    return `${css}\n${faces.join('\n')}`;
  })().catch((err) => {
    headCache = null;
    throw err;
  });
  return headCache;
}

async function launch() {
  const { chromium } = await import('playwright-core');
  if (process.env.VERCEL) {
    const bin = (await import('@sparticuz/chromium')).default;
    return chromium.launch({ executablePath: await bin.executablePath(), args: bin.args, headless: true });
  }
  return chromium.launch({ headless: true });
}

type Browser = Awaited<ReturnType<typeof launch>>;

/** One report printed in an open browser: its own context, JavaScript off, every request but data: refused. */
async function printIn(browser: Browser, model: PdfModel): Promise<Buffer> {
  const html = reportDocument(model, await head());
  const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'light' });
  try {
    await context.route('**/*', (route) =>
      route.request().url().startsWith('data:') ? route.continue() : route.abort(),
    );
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 20_000 });
    // Chromium's header/footer templates are separate documents that can't read the page's CSS
    // variables; #52525b = zinc-600 = --aura-fg-secondary
    // eslint-disable-next-line aura/no-hardcoded-color -- see above
    const muted = '#52525b';
    const small = `font-family:Inter,sans-serif;font-size:8px;color:${muted};width:100%;padding:0 15mm;`;
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      // the header strip is in the page (document.ts); the footer template holds only digits and words in Latin
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="${small}text-align:right">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
      margin: { top: '13mm', bottom: '18mm', left: '15mm', right: '15mm' },
    });
  } finally {
    await context.close();
  }
}

/** The PDF bytes for one report (the route: one browser per request). */
export async function renderReportPdf(model: PdfModel): Promise<Buffer> {
  const browser = await launch();
  try {
    return await printIn(browser, model);
  } finally {
    await browser.close();
  }
}

/**
 * For many reports in one run (the drafts cron): Chromium starts on the first print, not before — a run
 * where nothing changed launches nothing — and every print reuses it until `close`.
 */
export function pdfPrinter(): { render: (model: PdfModel) => Promise<Buffer>; close: () => Promise<void> } {
  let browser: Promise<Browser> | null = null;
  return {
    render: async (model) => printIn(await (browser ??= launch()), model),
    close: async () => {
      if (browser) await (await browser.catch(() => null))?.close();
    },
  };
}
