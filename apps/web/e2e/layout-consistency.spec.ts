import { expect, test, type Browser, type Page } from '@playwright/test';
import { ensureUser, localSupabaseEnabled, signIn, anySiteId, busySiteId } from './support/local-supabase';

/**
 * Rules every signed-in page shares, measured in the browser at 390 / 820 / 1440 — the things a
 * per-board review misses because they live across pages (docs/retro.md, 7 Oct 2026):
 * - page header rhythm (D-018): 4 px between breadcrumb or eyebrow, title and meta line (all inside
 *   AURA PageHeader's text block since 5.33's breadcrumb slot);
 * - phone shell (D-018): the top bar with brand + avatar below lg, no top bar from lg;
 * - touch targets ≥ 44 px below lg (spec §14.17), counting the hit area AURA adds around a compact
 *   control on a touch screen (`::after` under pointer: coarse);
 * - no sideways scroll at any width — the page, and any box inside it such as a table's scroll area
 *   (S05c /verify: the Sites table scrolled 2 px at 820 and 30 px at 1440 while the page didn't).
 * Below lg each width runs as a touch device (isMobile + hasTouch), as a phone or tablet would.
 * The pages come from the live nav, so each page a slice flips `live` is checked from then on.
 * Signs in as the seeded Admin to see every page. Local Supabase only (E2E_LOCAL_SUPABASE=1).
 */
const ADMIN = { email: 'tao@example.test', name: 'Tao' };
const WIDTHS = [390, 820, 1440] as const;
const LG = 1024;
const GAP = 4;
const TOUCH = 44;

/** A signed-in page at `width`; below lg a touch device, as a phone or tablet. */
async function signedInAt(browser: Browser, baseURL: string, width: number): Promise<Page> {
  const touch = width < LG;
  const context = await browser.newContext({
    baseURL,
    viewport: { width, height: 900 },
    isMobile: touch,
    hasTouch: touch,
  });
  await signIn(context, baseURL, ADMIN.email);
  return context.newPage();
}

/** Pages of the live main nav, read from the sidebar (visible from lg). */
async function livePages(page: Page): Promise<string[]> {
  await page.goto('/');
  const hrefs = await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link')
    .evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));
  return [...new Set(hrefs.filter((h) => h.startsWith('/')))];
}

/** Vertical gaps between the header's parts, top to bottom (breadcrumb, eyebrow, title, meta). */
function headerGaps(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector('main .aura-page-header');
    if (!header) return null;
    const parts: Element[] = [];
    const text = header.querySelector('.aura-page-header__text');
    if (text) parts.push(...Array.from(text.children));
    const boxes = parts.map((el) => el.getBoundingClientRect());
    return boxes.slice(1).map((box, i) => Math.round((box.top - boxes[i]!.bottom) * 10) / 10);
  });
}

/** Visible boxes that scroll sideways (a table wider than its frame); chip rows meant to scroll opt out. */
function sidewaysBoxes(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('main *'))
      .filter((el) => {
        const x = getComputedStyle(el).overflowX;
        if (x !== 'auto' && x !== 'scroll') return false;
        if (el.clientWidth === 0 || el.closest('[data-scroll-x]')) return false;
        return el.scrollWidth > el.clientWidth + 1;
      })
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${el.className.toString().split(' ')[0]} ${el.scrollWidth}/${el.clientWidth}`,
      ),
  );
}

/**
 * Boxes inside the page whose right edge is past the screen's — clipped rather than scrolled, so the
 * sideways check above can't see them (S06 /verify: a chart card wider than a 375 px phone). Boxes in a
 * box that scrolls or clips on its own (`data-scroll-x`, any overflow-x but visible below main, e.g.
 * DataTable's off-screen measuring rows) are left out.
 */
function boxesPastEdge(page: Page) {
  return page.evaluate(() => {
    const edge = document.documentElement.clientWidth + 1;
    const inScroller = (el: Element) => {
      for (let p = el.parentElement; p && p.tagName !== 'MAIN'; p = p.parentElement) {
        const x = getComputedStyle(p).overflowX;
        if (x !== 'visible' || p.hasAttribute('data-scroll-x')) return true;
      }
      return false;
    };
    return Array.from(document.querySelectorAll<HTMLElement>('main *'))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.right > edge && !inScroller(el);
      })
      .slice(0, 5)
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${el.className.toString().split(' ')[0]} right ${Math.round(el.getBoundingClientRect().right)}`,
      );
  });
}

/** Visible block-level controls whose tap area is shorter than a touch target. */
function smallTargets(page: Page) {
  return page.evaluate((min) => {
    /** The taller of the control and the hit area AURA draws around it on a touch screen. */
    const hitHeight = (control: HTMLElement) => {
      // A field's input sits inside AURA's bordered box (.aura-input); a radio or checkbox inside its
      // label row (.aura-choice / .aura-switch-row / label): that box is what a finger hits (S05, the first forms).
      const el =
        control.closest<HTMLElement>('.aura-input, .aura-choice, .aura-switch-row, label') ?? control;
      const after = getComputedStyle(el, '::after');
      const extra = after.content !== 'none' && after.position === 'absolute' ? parseFloat(after.height) : 0;
      return Math.max(el.getBoundingClientRect().height, Number.isNaN(extra) ? 0 : extra);
    };
    const controls = document.querySelectorAll<HTMLElement>(
      'a[href], button, [role="button"], input:not([type="hidden"]), select, textarea',
    );
    return Array.from(controls)
      .filter((el) => {
        const box = el.getBoundingClientRect();
        // Inline text links are exempt (WCAG 2.5.8); hidden controls aren't tappable.
        if (getComputedStyle(el).display === 'inline' || box.width === 0 || box.height === 0) return false;
        return hitHeight(el) < min;
      })
      .map((el) => {
        const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40);
        return `${el.tagName.toLowerCase()} "${name}" ${Math.round(hitHeight(el))}px`;
      });
  }, TOUCH);
}

test.describe('layout consistency on every live page (local Supabase)', () => {
  test.skip(!localSupabaseEnabled, 'needs the local Supabase stack: E2E_LOCAL_SUPABASE=1');
  // One run covers all three widths itself; the phone project would only repeat it.
  test.skip(({ isMobile }) => isMobile, 'widths are set inside the test');

  test('header rhythm, phone shell, touch targets, no sideways scroll', async ({ browser, baseURL }) => {
    await ensureUser(ADMIN.email);
    // The sidebar (and so the nav links) is only visible from lg.
    const desktop = await signedInAt(browser, baseURL!, 1440);
    const pages = await livePages(desktop);
    await desktop.context().close();
    expect(pages).not.toHaveLength(0);
    // Pages reached from a list, not the nav (S05 review): Add site, Edit site, Edit monitors.
    const site = await anySiteId();
    pages.push(
      `/sites/${await busySiteId()}`,
      '/sites/new',
      `/sites/${site}/edit`,
      `/sites/${site}/monitors`,
    );

    for (const width of WIDTHS) {
      const page = await signedInAt(browser, baseURL!, width);

      for (const path of pages) {
        await test.step(`${path} at ${width} px`, async () => {
          await page.goto(path);
          await expect(page.locator('main h1')).toBeVisible();

          const scroll = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
          expect(scroll, 'no sideways scroll').toBeLessThanOrEqual(0);
          expect(await sidewaysBoxes(page), 'no box inside the page scrolls sideways').toEqual([]);
          expect(await boxesPastEdge(page), 'no box reaches past the screen edge').toEqual([]);

          const gaps = await headerGaps(page);
          expect(gaps, 'the page starts with AURA PageHeader').not.toBeNull();
          for (const gap of gaps!) expect(gap, 'header parts 4 px apart (D-018)').toBeCloseTo(GAP, 0);

          const bar = page.locator('.aura-shell__bar');
          if (width < LG) {
            await expect(bar, 'phone top bar').toBeVisible();
            await expect(bar.getByText('DxT')).toBeVisible();
            await expect(bar.getByLabel(ADMIN.name)).toBeVisible();
            expect(await smallTargets(page), 'touch targets ≥ 44 px').toEqual([]);
          } else {
            await expect(bar, 'no top bar where the sidebar shows').toBeHidden();
          }
        });
      }
      await page.context().close();
    }
  });
});
