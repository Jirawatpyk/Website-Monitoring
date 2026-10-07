import { chromium, type Browser, type Response } from 'playwright';
import type { PageBrowser, PageVisit } from './verifier';

/** Statuses a challenge page answers with; a JS challenge then redirects to the real page. */
const CHALLENGE_STATUSES = new Set([403, 429, 503]);

/**
 * Plain headless Chromium (no stealth plugin, PRD §5), one browser for the process and a fresh
 * context per visit, so no cookie or challenge pass carries over from one check to the next.
 * Glue around Playwright only — the decisions live in verifier.ts.
 */
export async function launchBrowser(): Promise<PageBrowser & { close(): Promise<void> }> {
  let browser: Browser | null = null;
  const ensure = async () => {
    if (!browser?.isConnected()) browser = await chromium.launch({ headless: true });
    return browser;
  };
  return {
    async visit(url: string, timeoutMs: number): Promise<PageVisit> {
      const deadline = Date.now() + timeoutMs;
      const context = await (await ensure()).newContext({ viewport: { width: 1366, height: 768 } });
      try {
        const page = await context.newPage();
        // The last main-document response: after a JS challenge passes, that's the real page.
        let last: Response | null = null;
        page.on('response', (r) => {
          if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) last = r;
        });
        last = await page.goto(url, { timeout: timeoutMs, waitUntil: 'load' });
        if (last && CHALLENGE_STATUSES.has(last.status())) {
          // Give a browser challenge the rest of the 20 s to pass, as it would for a visitor.
          await page
            .waitForLoadState('networkidle', { timeout: Math.max(1_000, deadline - Date.now()) })
            .catch(() => undefined);
        }
        const final = last as Response | null;
        const [html, screenshot] = await Promise.all([
          page.content(),
          page.screenshot({ type: 'jpeg', quality: 60, timeout: 5_000 }).catch(() => null),
        ]);
        return {
          status: final?.status() ?? null,
          headers: final ? await final.allHeaders() : {},
          html,
          screenshot,
        };
      } finally {
        await context.close().catch(() => undefined);
      }
    },
    async close() {
      await browser?.close().catch(() => undefined);
    },
  };
}
