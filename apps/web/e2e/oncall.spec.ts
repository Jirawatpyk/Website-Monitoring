import { expect, test } from '@playwright/test';
import {
  ensureRotation,
  ensureUser,
  localSupabaseEnabled,
  resetOncall,
  signIn,
} from './support/local-supabase';

// S10 B2c (spec §27, §28; D-048): the On-call page through the API — an Admin saves the rotation; Arm asks
// Nok to swap, Nok accepts, Tao approves and the weeks swap; a one-person rotation turns Swap off.
// Local Supabase only (E2E_LOCAL_SUPABASE=1, after `pnpm db:reset`). The rotation is one shared table:
// these run once, in the desktop project, one after another, and leave no rotation behind.
test.describe('on-call (local Supabase)', () => {
  test.skip(!localSupabaseEnabled, 'needs the local Supabase stack: E2E_LOCAL_SUPABASE=1');
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(({ baseURL: _ }, info) => {
    test.skip(info.project.name !== 'desktop', 'one shared rotation: desktop only');
  });
  // A skipped (mobile) test still runs afterEach: only desktop may clear the rotation it owns.
  test.afterEach(async ({ baseURL: _ }, info) => {
    if (info.project.name === 'desktop') await resetOncall();
  });

  test('an Admin saves a new order (Edit rotation, through the API)', async ({ page, context, baseURL }) => {
    await ensureUser('tao@example.test');
    await ensureRotation(['arm@example.test', 'ploy@example.test', 'nok@example.test']);
    await signIn(context, baseURL!, 'tao@example.test');
    await page.goto('/oncall');
    await page.getByRole('button', { name: 'Edit rotation' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Edit rotation' });
    await expect(dialog).toContainText('Changes apply from');
    await dialog.getByRole('button', { name: 'Move Nok up' }).click();
    await expect(dialog).toContainText('Arm, Nok and Ploy get a Chat message with their new weeks · logged');
    await dialog.getByRole('button', { name: 'Save rotation' }).click();
    // No refusal: the RPC runs through PostgREST, where pg_safeupdate is loaded (retro 30 Oct).
    await expect(dialog).toBeHidden();
  });

  test('a swap goes request → accept → approve and the weeks swap (§27)', async ({
    page,
    context,
    baseURL,
  }) => {
    for (const u of ['tao', 'arm', 'nok']) await ensureUser(`${u}@example.test`);
    await ensureRotation(['arm@example.test', 'ploy@example.test', 'nok@example.test']);

    // Arm (week 4) asks Nok (week 3).
    await signIn(context, baseURL!, 'arm@example.test');
    await page.goto('/oncall');
    await page.getByRole('button', { name: 'Swap', exact: true }).first().click();
    const ask = page.getByRole('dialog', { name: /^Swap Arm’s week/ });
    await ask.getByRole('combobox', { name: 'Swap with' }).click();
    await page.getByRole('option', { name: 'Nok' }).click();
    await ask.getByRole('button', { name: 'Send swap request' }).click();
    await expect(page).toHaveURL(/\/oncall\?swap=/);
    const url = page.url();
    await expect(page.getByText('Waiting for Nok to accept, then an Admin approves.').first()).toBeAttached();

    // Nok opens the link from Chat and accepts.
    await context.clearCookies();
    await signIn(context, baseURL!, 'nok@example.test');
    await page.goto(url);
    await expect(page.getByText('Arm asks you to swap weeks').first()).toBeVisible();
    await page.getByRole('button', { name: 'Accept' }).first().click();
    await expect(page.getByText(/^Accepted · waiting for an Admin to approve/).first()).toBeVisible();

    // Tao approves.
    await context.clearCookies();
    await signIn(context, baseURL!, 'tao@example.test');
    await page.goto(url);
    await page.getByRole('button', { name: 'Approve' }).first().click();
    await expect(page.getByText('Approved — the weeks have swapped.').first()).toBeVisible();
    await expect(page.getByText(/^Swapped · /).first()).toBeVisible();
    // The column widths are tuned so the table fits beside the swap card at 1440 (OnCall): it never
    // scrolls sideways there — a change to AURA's table padding or the longest week fails here.
    // From xl the card sits beside the table and the alerts column drops out when the table is under
    // 740 px (1280); below xl the card goes under the table. The widths switch after a re-render, so poll.
    const scroll = page.locator('.aura-table__scroll').first();
    for (const width of [1440, 1280, 1100]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect
        .poll(() => scroll.evaluate((e) => [e.scrollWidth, e.clientWidth].join(' / ')), {
          message: `the rotation table fits at ${width}, with the swap card`,
        })
        .toMatch(/^(\d+) \/ \1$/);
    }
  });

  test('a one-person rotation turns Swap off with its reason, on a phone too (§28.4)', async ({
    page,
    context,
    baseURL,
  }) => {
    await ensureUser('ploy@example.test');
    await ensureRotation(['ploy@example.test']);
    await signIn(context, baseURL!, 'ploy@example.test');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/oncall');
      const swap = page.getByRole('button', { name: width === 390 ? 'Request swap' : 'Swap', exact: true });
      await expect(swap.filter({ visible: true }).first()).toBeDisabled();
      await expect(page.getByText(/[Nn]obody else in the rotation to swap with/).first()).toBeAttached();
    }
  });
});
