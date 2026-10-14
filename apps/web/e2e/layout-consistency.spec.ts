import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  anySiteId,
  busySiteId,
  ensureUser,
  localSupabaseEnabled,
  openTestIncident,
  signIn,
} from './support/local-supabase';

/**
 * Rules every signed-in page shares, measured in the browser at 390 / 820 / 1440 — the things a
 * per-board review misses because they live across pages (docs/retro.md, 7 Oct 2026):
 * - page header rhythm (D-018): 4 px between breadcrumb or eyebrow, title and meta line (all inside
 *   AURA PageHeader's text block since 5.33's breadcrumb slot);
 * - phone shell (D-018, D-045): the top bar below lg — back arrow off the tabs, the page title (the brand on Overview), avatar — no top bar from lg;
 * - touch targets ≥ 44 px below lg (spec §14.17), counting the hit area AURA adds around a compact
 *   control on a touch screen (`::after` under pointer: coarse);
 * - no sideways scroll at any width — the page, and any box inside it such as a table's scroll area
 *   (S05c /verify: the Sites table scrolled 2 px at 820 and 30 px at 1440 while the page didn't);
 * - no short text squeezed a character or two a line (S06b production, the Live issues p50).
 * Below lg each width runs as a touch device (isMobile + hasTouch), as a phone or tablet would.
 * The pages come from the live nav, so each page a slice flips `live` is checked from then on.
 * Signs in as the seeded Admin to see every page. Local Supabase only (E2E_LOCAL_SUPABASE=1).
 */
const ADMIN = { email: 'tao@example.test', name: 'Tao' };
const WIDTHS = [390, 820, 1440] as const;
const LG = 1024;
const MD = 768;
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
    // What shows: below lg the phone top bar carries the title (visually hidden, still the h1) and the
    // breadcrumb / section eyebrow (gone) — D-045.
    if (text)
      parts.push(
        ...Array.from(text.children).filter((el) => {
          const css = getComputedStyle(el);
          return css.display !== 'none' && css.position !== 'absolute';
        }),
      );
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

/**
 * Short text squeezed into a sliver of a table or flex row, one or two characters a line (S06b
 * production: the Live issues p50 "628 ms" stood 11 px wide and 80 px tall at 1440).
 */
function squeezedText(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('main *'))
      .filter((el) => {
        const own = Array.from(el.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent ?? '')
          .join('')
          .trim();
        if (own.length < 3 || own.length > 40) return false;
        const r = el.getBoundingClientRect();
        const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
        return r.width > 0 && r.height > line * 2.5 && r.width < line * 1.5;
      })
      .slice(0, 5)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return `"${el.textContent?.trim()}" ${Math.round(r.width)}×${Math.round(r.height)}`;
      }),
  );
}

/**
 * Controls whose focus ring would be cut off: the outline reaches past the nearest ancestor that clips
 * (overflow hidden / clip on every side; auto / scroll across the axis it doesn't scroll — along it, a
 * control half out of view is a scroll position, not a cut ring). Twice in S07 a ring lost a side to
 * its box — a dialog's outcome line, DataTable's row link — and only Tao's eye caught it. Call after a
 * key press, so the page is in keyboard mode and `:focus-visible` matches a programmatic focus.
 */
function clippedFocusRings(page: Page) {
  return page.evaluate(() => {
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>(
        'main a[href], main button:not([disabled]), main [role="radio"], main [tabindex]:not([tabindex="-1"])',
      ),
    )
      .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
      // table rows repeat one another: the first controls cover every kind on the page, and a long
      // list stays fast
      .slice(0, 60);
    const out: string[] = [];
    for (const el of controls) {
      el.focus();
      if (document.activeElement !== el) continue;
      const style = getComputedStyle(el);
      if (style.outlineStyle === 'none') continue;
      const reach = (parseFloat(style.outlineWidth) || 0) + (parseFloat(style.outlineOffset) || 0);
      if (reach <= 0) continue;
      const box = el.getBoundingClientRect();
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (!/(hidden|clip|auto|scroll)/.test(ps.overflowX + ps.overflowY)) continue;
        const pb = p.getBoundingClientRect();
        const scrolls = (o: string) => o === 'auto' || o === 'scroll';
        // overflow: clip paints this far past the box (the table cells, globals.css)
        const margin =
          ps.overflowX === 'clip' ? parseFloat(ps.getPropertyValue('overflow-clip-margin')) || 0 : 0;
        const room =
          margin +
          Math.min(
            ...(scrolls(ps.overflowX) ? [] : [box.left - pb.left, pb.right - box.right]),
            ...(scrolls(ps.overflowY) ? [] : [box.top - pb.top, pb.bottom - box.bottom]),
          );
        if (room < reach - 0.5) {
          const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40);
          out.push(
            `${el.tagName.toLowerCase()} "${name}" ring ${reach}px, room ${Math.round(room)}px in .${String(p.className).split(' ')[0]} (overflow ${ps.overflowX}, clip margin ${margin}px)`,
          );
        }
        break;
      }
    }
    (document.activeElement as HTMLElement | null)?.blur();
    return out;
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

/**
 * Phone header actions that stop short of the row: below md a page's header buttons span the content
 * width, as /maintenance's Schedule button does (S09 retro — Site detail's grid fell 22 px short inside
 * AURA's actions box, and Sites' Add site hugged its label).
 */
function shortPhoneActions(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const header of document.querySelectorAll<HTMLElement>('main .aura-page-header')) {
      const actions = header.querySelector<HTMLElement>(':scope > .aura-page-header__actions');
      if (!actions) continue;
      const controls = Array.from(actions.querySelectorAll<HTMLElement>('a[href], button')).filter((el) => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      });
      if (!controls.length) continue;
      const row = header.getBoundingClientRect();
      const boxes = controls.map((el) => el.getBoundingClientRect());
      const left = Math.min(...boxes.map((b) => b.left));
      const right = Math.max(...boxes.map((b) => b.right));
      if (left - row.left > 2 || row.right - right > 2) {
        const names = controls.map((el) => (el.textContent ?? '').trim().slice(0, 24)).join(' / ');
        out.push(`"${names}" spans ${Math.round(right - left)} of ${Math.round(row.width)} px`);
      }
    }
    return out;
  });
}

test.describe('layout consistency on every live page (local Supabase)', () => {
  test.skip(!localSupabaseEnabled, 'needs the local Supabase stack: E2E_LOCAL_SUPABASE=1');
  // One run covers all three widths itself; the phone project would only repeat it.
  test.skip(({ isMobile }) => isMobile, 'widths are set inside the test');

  test('header rhythm, phone shell, touch targets, no sideways scroll', async ({ browser, baseURL }) => {
    // every live page at three widths: well past the 30 s default once the focus-ring walk joined (S07)
    test.setTimeout(120_000);
    await ensureUser(ADMIN.email);
    // the longest copy the pages must fit: an incident left unacked for a day ("1 d 2 h unacked",
    // "since Thu 9 Oct 05:10") — the Overview's Live issues scrolled at 820 with one
    await openTestIncident(ADMIN.email, { ageMinutes: 26 * 60 });
    // The sidebar (and so the nav links) is only visible from lg.
    const desktop = await signedInAt(browser, baseURL!, 1440);
    const pages = await livePages(desktop);
    await desktop.context().close();
    expect(pages).not.toHaveLength(0);
    // Pages reached from a list, not the nav (S05 review): Add site, Edit site, Edit monitors; and an
    // open incident (S07).
    const site = await anySiteId();
    pages.push(
      `/sites/${await busySiteId()}`,
      '/sites/new',
      `/sites/${site}/edit`,
      `/sites/${site}/monitors`,
      `/incidents/${await openTestIncident(ADMIN.email)}`,
    );

    for (const width of WIDTHS) {
      const page = await signedInAt(browser, baseURL!, width);

      for (const path of pages) {
        await test.step(`${path} at ${width} px`, async () => {
          await page.goto(path);
          // Every page keeps its h1; below lg most show their title in the top bar instead (D-045).
          await expect(page.locator('main h1')).toBeAttached();
          if (width >= LG) await expect(page.locator('main h1')).toBeVisible();

          const scroll = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
          expect(scroll, 'no sideways scroll').toBeLessThanOrEqual(0);
          expect(await sidewaysBoxes(page), 'no box inside the page scrolls sideways').toEqual([]);
          expect(await boxesPastEdge(page), 'no box reaches past the screen edge').toEqual([]);
          expect(await squeezedText(page), 'no text squeezed a character or two a line').toEqual([]);
          await page.keyboard.press('Tab');
          expect(await clippedFocusRings(page), 'no focus ring cut off by its box').toEqual([]);

          const gaps = await headerGaps(page);
          expect(gaps, 'the page starts with AURA PageHeader').not.toBeNull();
          for (const gap of gaps!) expect(gap, 'header parts 4 px apart (D-018)').toBeCloseTo(GAP, 0);

          const bar = page.locator('.aura-shell__bar');
          if (width < LG) {
            await expect(bar, 'phone top bar').toBeVisible();
            // §22.1, D-045: the brand on Overview; elsewhere the page's title, and a back arrow off the tabs.
            const tab = ['/', '/incidents', '/sites'].includes(path);
            if (path === '/') await expect(bar.getByText('DxT')).toBeVisible();
            else await expect(bar.locator('p').first(), 'the page title in the bar').not.toBeEmpty();
            await expect(bar.getByRole('link', { name: /^Back to / })).toHaveCount(tab ? 0 : 1);
            await expect(bar.getByLabel(ADMIN.name)).toBeVisible();
            expect(await smallTargets(page), 'touch targets ≥ 44 px').toEqual([]);
            if (width < MD)
              expect(await shortPhoneActions(page), 'phone header actions span the page').toEqual([]);
          } else {
            await expect(bar, 'no top bar where the sidebar shows').toBeHidden();
          }
        });
      }
      await page.context().close();
    }
  });
});
