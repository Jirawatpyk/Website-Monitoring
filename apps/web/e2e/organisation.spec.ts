import { expect, test, type Page } from '@playwright/test';
import { ensureUser, localSupabaseEnabled, signIn } from './support/local-supabase';

// S17 PR 1 (D-069): Settings › Organisation. Local Supabase only. The spec changes the one
// response-hours setting and puts it back, so other specs see the seeded hours.
/** The Tier 2–3 editor's To select (its native select; the panel holds Days, From, To). */
const toField = (page: Page) =>
  page
    .getByRole('heading', { name: 'Tier 2–3 · response hours' })
    .locator('xpath=ancestor::div[contains(@class, "rounded-aura-md")][1]')
    .locator('select.aura-select__native')
    .nth(2);

test.describe('organisation (local Supabase)', () => {
  test.skip(!localSupabaseEnabled, 'needs the local Supabase stack: E2E_LOCAL_SUPABASE=1');

  test('an Admin changes the response hours with a note; the confirm says who it affects (Done-when 1)', async ({
    page,
    context,
    baseURL,
  }, info) => {
    test.skip(info.project.name === 'mobile', 'view only on phones (§22.5)');
    await ensureUser('tao@example.test');
    await signIn(context, baseURL!, 'tao@example.test');
    await page.goto('/settings/organisation');
    await expect(page.getByRole('heading', { name: 'Tier 2–3 · response hours' })).toBeVisible();

    const to = toField(page);
    const was = await to.inputValue();
    const next = was === '17:30' ? '18:00' : '17:30';
    try {
      await to.selectOption(next);
      await expect(page.getByRole('region', { name: 'Unsaved changes' })).toBeVisible();
      await page.getByRole('button', { name: 'Save', exact: true }).click();

      const dialog = page.getByRole('dialog', { name: 'Change response hours?' });
      await expect(dialog.getByText(/^Affects \d+ sites? · \d+ in Tier 2, \d+ in Tier 3$/)).toBeVisible();
      await expect(dialog.getByText('Tier 1 · owner hours')).toBeVisible();
      await dialog.getByRole('button', { name: 'Save and log' }).click();
      await expect(
        dialog.getByText('Add a short note — it goes in the audit log with the change'),
      ).toBeVisible();
      await dialog.getByRole('textbox', { name: /Change note/ }).fill('e2e: response hours');
      await dialog.getByRole('button', { name: 'Save and log' }).click();

      await expect(
        page.getByText(new RegExp(`^Saved — .* 09:00–${next}, in use within a minute\\.$`)),
      ).toBeFocused();
      await expect(page.getByRole('region', { name: 'Unsaved changes' })).toHaveCount(0);
    } finally {
      // Put the seeded hours back.
      await page.goto('/settings/organisation');
      const back = toField(page);
      if ((await back.inputValue()) !== was) {
        await back.selectOption(was);
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Change response hours?' });
        await dialog.getByRole('textbox', { name: /Change note/ }).fill('e2e: put back');
        await dialog.getByRole('button', { name: 'Save and log' }).click();
        await expect(page.getByText(/^Saved — /)).toBeVisible();
      }
    }
  });

  test('on a phone it is view only', async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name !== 'mobile', 'phone view');
    await ensureUser('tao@example.test');
    await signIn(context, baseURL!, 'tao@example.test');
    await page.goto('/settings/organisation');
    await expect(page.getByText('View only on phones.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    // The Settings pages are a select on a phone (§35.1).
    await page.locator('select.aura-select__native').first().selectOption({ label: 'Users & roles' });
    await expect(page).toHaveURL(/\/settings\/users$/);
  });
});
