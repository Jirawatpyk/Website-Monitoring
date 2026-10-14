import { expect, test } from '@playwright/test';
import { anySiteId, ensureUser, localSupabaseEnabled, signIn } from './support/local-supabase';

const ADMIN = { email: 'tao@example.test', name: 'Tao' };

/**
 * The phone top bar comes from the `@bar` parallel-route slot (D-045). Two things a slot can get wrong:
 * keeping the previous page's bar after a client-side navigation, and a catch-all slot page turning an
 * unknown URL into a page that loads forever with a 200 (found while building it; the slot has one page per
 * route instead, guarded by `loading-coverage.test.ts`).
 */
test.describe('phone top bar (local Supabase)', () => {
  test.skip(!localSupabaseEnabled, 'needs the local Supabase stack: E2E_LOCAL_SUPABASE=1');
  test.skip(({ isMobile }) => !isMobile, 'the bar shows below lg');

  test('follows client-side navigation: Sites → a site → back → Overview', async ({
    context,
    page,
    baseURL,
  }) => {
    await ensureUser(ADMIN.email);
    await signIn(context, baseURL!, ADMIN.email);
    const site = await anySiteId();
    const bar = page.locator('.aura-shell__bar');

    await page.goto('/sites');
    await expect(bar.locator('p').first()).toHaveText('Sites');
    await expect(bar.getByRole('link', { name: /^Back to / })).toHaveCount(0);

    await page.locator(`a[href="/sites/${site}"]:visible`).first().click();
    await expect(page).toHaveURL(new RegExp(`/sites/${site}$`));
    await expect(bar.getByRole('link', { name: 'Back to sites' })).toBeVisible();
    await expect(bar.locator('p').first()).not.toHaveText('Sites');
    await expect(bar.getByRole('button', { name: /^More actions for / })).toBeVisible();

    await bar.getByRole('link', { name: 'Back to sites' }).click();
    await expect(page).toHaveURL(/\/sites$/);
    await expect(bar.locator('p').first()).toHaveText('Sites');
    await expect(bar.getByRole('button', { name: /^More actions for / })).toHaveCount(0);

    await page
      .getByRole('navigation', { name: 'Sections' })
      .getByRole('link', { name: /Overview/ })
      .click();
    await expect(page).toHaveURL(/\/$/);
    await expect(bar.getByText('DxT')).toBeVisible();
  });

  test('an unknown address is still a 404', async ({ context, page, baseURL }) => {
    await ensureUser(ADMIN.email);
    await signIn(context, baseURL!, ADMIN.email);
    const response = await page.goto('/no-such-page');
    expect(response?.status()).toBe(404);
    // A site or incident that doesn't exist: 404, not a 200 streamed by the page's loading skeleton.
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await page.goto(`/sites/${missing}`))?.status()).toBe(404);
    await expect(page.getByText('No site at this address')).toBeVisible();
    await expect(page).toHaveTitle('Site not found · DxT Monitor');
    expect((await page.goto(`/sites/${missing}/edit`))?.status()).toBe(404);
    expect((await page.goto(`/incidents/${missing}`))?.status()).toBe(404);
    await expect(page.getByText('No incident at this address')).toBeVisible();
    // The page's own metadata streams after the not-found page's, so its fallback names the tab.
    await expect(page).toHaveTitle('Incident not found · DxT Monitor');
  });
});
