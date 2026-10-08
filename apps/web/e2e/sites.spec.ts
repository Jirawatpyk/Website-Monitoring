import { expect, type Page, test } from '@playwright/test';
import { ensureUser, localSupabaseEnabled, signIn, siteAudit } from './support/local-supabase';

// S05: an Admin registers a site through the UI — Draft with empty owners, then owners and Start,
// then a monitor edit, then Stop — and every change leaves its audit row (Done-when 3, 5; D-025).
// Local Supabase only (E2E_LOCAL_SUPABASE=1, after `pnpm db:reset`); the URL check needs public DNS.
test.describe('register a site (local Supabase)', () => {
  test.skip(!localSupabaseEnabled, 'needs the local Supabase stack: E2E_LOCAL_SUPABASE=1');

  test.beforeEach(async ({ context, baseURL }) => {
    await ensureUser('tao@example.test'); // seeded Admin
    await signIn(context, baseURL!, 'tao@example.test');
  });

  /** AURA Select: open its list, pick the option. */
  async function choose(page: Page, label: string, option: string) {
    await page.getByRole('combobox', { name: label }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  }

  test('Draft → owners → Start → edit a monitor → Stop, all in the audit log', async ({ page }) => {
    const run = crypto.randomUUID().slice(0, 8);
    await page.goto('/sites');
    await page.getByRole('link', { name: 'Add site' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Add site' })).toBeVisible();

    await page.getByLabel('Site name').fill(`E2E site ${run}`);
    await choose(page, 'Client', 'Internal (DxT group)');
    await page.getByRole('textbox', { name: /Primary URL/ }).fill(`https://example.com/?e2e=${run}`);
    await page.getByLabel('Hosting provider').fill('Example hosting');
    await page.getByLabel(/Must contain/).fill('Example Domain');
    await expect(page.getByRole('button', { name: 'Start monitoring' })).toBeDisabled();
    await expect(page.getByText(/items? left: .*Primary owner/)).toBeVisible();

    // A Draft may leave the owners empty (D-025).
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Draft saved')).toBeVisible();
    const siteId = page.url().match(/sites\/([0-9a-f-]{36})\/edit/)![1]!;

    await choose(page, 'Primary owner', 'Nok');
    await choose(page, 'Backup owner', 'Ploy');
    await page.getByRole('textbox', { name: /Credential reference/ }).fill('Team vault › E2E');
    await expect(page.getByText('8/8')).toBeVisible();
    await page.getByRole('button', { name: 'Start monitoring' }).click();
    await expect(page.getByText(/^Started \d\d:\d\d · first round within 3 min/)).toBeVisible();

    await page.getByRole('link', { name: 'Edit monitors' }).click();
    await expect(page.getByRole('button', { name: 'No changes' })).toBeDisabled();
    await page.getByLabel('Timeout').fill('20');
    await expect(page.getByText('1 unsaved change')).toBeVisible();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Saved — takes effect on the next round')).toBeVisible();

    await page.goto(`/sites/${siteId}/edit`);
    await page.getByRole('button', { name: 'Stop monitoring' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Owner and backup: Nok and Ploy');
    await dialog.getByRole('button', { name: 'Stop monitoring' }).click();
    await expect(page.getByRole('button', { name: 'Start monitoring' })).toBeVisible();

    // One row per change, each by the Admin (Done-when 3).
    const audit = await siteAudit(siteId);
    const actions = audit.map((a) => a.action);
    // The site and its primary monitor are written in one transaction: same `at`, either order.
    expect(actions.slice(0, 2).sort()).toEqual(['monitor.create', 'site.create']);
    expect(actions.slice(2)).toEqual([
      'site.update', // owners + credential
      'site.update', // Start
      'monitor.update', // timeout
      'site.update', // Stop
    ]);
    expect(new Set(audit.map((a) => a.actor))).toEqual(new Set(['tao@example.test']));
  });

  test('the Sites list opens the site and refuses a private URL', async ({ page }) => {
    await page.goto('/sites/new');
    await page.getByLabel('Site name').fill(`E2E private ${crypto.randomUUID().slice(0, 8)}`);
    await choose(page, 'Client', 'Internal (DxT group)');
    await page.getByRole('textbox', { name: /Primary URL/ }).fill('http://10.0.0.5/');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Not saved' })).toContainText(
      'This address points inside a private network — monitors check public sites only',
    );
    await expect(page).toHaveURL(/\/sites\/new$/);
  });
});
