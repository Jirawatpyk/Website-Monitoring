import { CHALLENGE_STATUSES } from '@dxt/probe';
import { chromium, type Browser, type Response } from 'playwright';
import type { PageBrowser, PageVisit } from './verifier';

/** A navigation replaced by another — what a passing JS challenge does mid-load. */
const REPLACED_NAVIGATION =
  /interrupted by another navigation|execution context was destroyed|frame was detached/i;

/**
 * Plain headless Chromium (no stealth plugin, PRD §5), one browser for the process and a fresh
 * context per visit, so no cookie or challenge pass carries over from one check to the next.
 * Glue around Playwright only — the decisions live in verifier.ts.
 */
export async function launchBrowser(): Promise<PageBrowser & { close(): Promise<void> }> {
  // One launch shared by every visit that needs it: three jobs at once never start three browsers.
  let launching: Promise<Browser> | null = null;
  const ensure = async (): Promise<Browser> => {
    const pending = launching;
    const current = pending && (await pending.catch(() => null));
    if (current?.isConnected()) return current;
    // Another visit may have started the relaunch while this one waited: share it.
    if (launching !== pending) return ensure();
    launching = chromium.launch({ headless: true });
    return launching;
  };
  return {
    async visit(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<PageVisit> {
      const deadline = Date.now() + timeoutMs;
      const remaining = () => Math.max(1_000, deadline - Date.now());
      const context = await (await ensure()).newContext({ viewport: { width: 1366, height: 768 } });
      try {
        if (headers) {
          // Custom headers go to the monitor's own origin only, as the HTTP probes send them.
          const origin = new URL(url).origin;
          await context.route('**/*', (route) => {
            const req = route.request();
            return new URL(req.url()).origin === origin
              ? route.continue({ headers: { ...req.headers(), ...headers } })
              : route.continue();
          });
        }
        const page = await context.newPage();
        // The last main-document response: after a JS challenge passes, that's the real page.
        let last: Response | null = null;
        page.on('response', (r) => {
          if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) last = r;
        });
        try {
          // The listener has the latest navigation (a challenge may have redirected during load).
          const response = await page.goto(url, { timeout: timeoutMs, waitUntil: 'load' });
          last ??= response;
        } catch (err) {
          // A challenge that passes while loading replaces the navigation: follow it, don't fail.
          if (!REPLACED_NAVIGATION.test(String(err))) throw err;
          await page.waitForLoadState('load', { timeout: remaining() }).catch(() => undefined);
        }
        const first = last as Response | null;
        if (first && CHALLENGE_STATUSES.has(first.status())) {
          // Give a browser challenge the rest of the 20 s to pass, as it would for a visitor.
          await page.waitForLoadState('networkidle', { timeout: remaining() }).catch(() => undefined);
        }
        const html = await page.content().catch(async () => {
          await page.waitForLoadState('load', { timeout: remaining() }).catch(() => undefined);
          return page.content();
        });
        const screenshot = await page
          .screenshot({ type: 'jpeg', quality: 60, timeout: 5_000 })
          .catch(() => null);
        const final = last as Response | null;
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
      const browser = launching && (await launching.catch(() => null));
      await browser?.close().catch(() => undefined);
    },
  };
}
