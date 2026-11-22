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

/** A Chromium step that never answers fails after `ms` instead of hanging the whole run (production, 22 Nov). */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const STEP_MS = 30_000;

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
  const context = await withTimeout(
    browser.newContext({ javaScriptEnabled: false, colorScheme: 'light' }),
    STEP_MS,
    'newContext',
  );
  try {
    await context.route('**/*', (route) =>
      route.request().url().startsWith('data:') ? route.continue() : route.abort(),
    );
    const page = await withTimeout(context.newPage(), STEP_MS, 'newPage');
    await page.setContent(html, { waitUntil: 'load', timeout: 20_000 });
    // Chromium's header/footer templates are separate documents that can't read the page's CSS
    // variables; #52525b = zinc-600 = --aura-fg-secondary
    // eslint-disable-next-line aura/no-hardcoded-color -- see above
    const muted = '#52525b';
    const small = `font-family:Inter,sans-serif;font-size:8px;color:${muted};width:100%;padding:0 15mm;`;
    return await withTimeout(
      page.pdf({
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: true,
        // the header strip is in the page (document.ts); the footer template holds only digits and words in Latin
        headerTemplate: '<span></span>',
        footerTemplate: `<div style="${small}text-align:right">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
        margin: { top: '13mm', bottom: '18mm', left: '15mm', right: '15mm' },
      }),
      STEP_MS,
      'pdf',
    );
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

/** What a printer needs: a way to start a browser, and to print one report in it. Tests pass fakes. */
export interface PrinterDeps<B extends { close: () => Promise<void> }> {
  launch: () => Promise<B>;
  print: (browser: B, model: PdfModel) => Promise<Buffer>;
  /**
   * Keep one browser for every print. Off on Vercel: `@sparticuz/chromium` runs Chromium with
   * `--single-process`, where a second page in the same browser never opens (production, 22 Nov:
   * one draft made, then the run hung to its 300 s limit).
   */
  reuse?: boolean;
}

/**
 * For many reports in one run (the drafts cron). Locally one browser serves every print; on Vercel each
 * print gets its own. Nothing launches until a print. A failed launch or print (a step past its
 * deadline too) drops that browser, so the next client starts a fresh one instead of failing too.
 */
export function pdfPrinter<B extends { close: () => Promise<void> } = Browser>(
  deps: PrinterDeps<B> = { launch, print: printIn, reuse: !process.env.VERCEL } as unknown as PrinterDeps<B>,
): { render: (model: PdfModel) => Promise<Buffer>; close: () => Promise<void> } {
  const reuse = deps.reuse ?? true;
  let browser: Promise<B> | null = null;
  const drop = async () => {
    const was = browser;
    browser = null;
    await (await was?.catch(() => null))?.close().catch(() => {});
  };
  return {
    render: async (model) => {
      const current = (browser ??= withTimeout(deps.launch(), STEP_MS, 'launch'));
      try {
        return await deps.print(await current, model);
      } catch (err) {
        if (browser === current) await drop();
        throw err;
      } finally {
        if (!reuse && browser === current) await drop();
      }
    },
    close: drop,
  };
}
