import { expect, test } from '@playwright/test';
import { ensureUser, localSupabaseEnabled, signIn } from './support/local-supabase';

// S18 (spec §18, D-070): the User guide opens on the viewer's role chip; search, Show all, and on the
// phone a topic opens as its own screen with the bar's back arrow to the list. Local Supabase only
// (E2E_LOCAL_SUPABASE=1, after `pnpm db:reset`).
test.describe('User guide (local Supabase)', () => {
  test.skip(!localSupabaseEnabled, 'needs the local Supabase stack: E2E_LOCAL_SUPABASE=1');

  test('an Admin opens on Admin, widens to all and searches', async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name !== 'desktop', 'the desktop layout');
    await ensureUser('tao@example.test');
    await signIn(context, baseURL!, 'tao@example.test');
    await page.goto('/guide');
    const topics = page.getByRole('navigation', { name: 'Guide topics' });
    await expect(page.getByText('Showing topics for you ·').locator('visible=true')).toContainText('Admin');
    await expect(topics.getByText('11 topics')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'When an alert arrives' })).toBeVisible();
    // The live ladder: the Admin token reads "every Admin".
    await expect(page.getByText(/Backup \+ every Admin/).first()).toBeVisible();

    await page.getByRole('radio', { name: 'Viewer' }).click();
    await expect(topics.getByText('2 of 11 topics · Viewer')).toBeVisible();
    await page.getByRole('radio', { name: 'All', exact: true }).click();
    await page.getByRole('textbox', { name: 'Search the guide' }).locator('visible=true').fill('root cause');
    await expect(
      page.getByRole('heading', { level: 2, name: 'Recover, root cause & resolve' }),
    ).toBeVisible();
  });

  test('a Viewer sees the two topics for Viewers', async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name !== 'desktop', 'the desktop layout');
    await ensureUser('mint@example.test');
    await signIn(context, baseURL!, 'mint@example.test');
    await page.goto('/guide');
    const topics = page.getByRole('navigation', { name: 'Guide topics' });
    await expect(topics.getByRole('button')).toHaveCount(2);
    await expect(topics.getByRole('button', { name: /Sign in & 2-step/ })).toBeVisible();
    await expect(topics.getByRole('button', { name: /Statuses & badges/ })).toBeVisible();
  });

  test('on the phone a topic opens on its own, and the bar goes back to the list', async ({
    page,
    context,
    baseURL,
  }, info) => {
    test.skip(info.project.name !== 'mobile', 'the phone layout');
    await ensureUser('arm@example.test');
    await signIn(context, baseURL!, 'arm@example.test');
    await page.goto('/guide');
    await expect(page.getByRole('group', { name: 'Filter by role' })).toBeVisible();
    await page
      .getByRole('button', { name: /Mute vs maintenance/ })
      .locator('visible=true')
      .click();
    await expect(page).toHaveURL(/\/guide\?topic=mute$/);
    await expect(
      page.getByRole('heading', { level: 2, name: 'Mute vs maintenance' }).locator('visible=true'),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Back to all topics' }).click();
    await expect(page).toHaveURL(/\/guide$/);
    await expect(page.getByRole('group', { name: 'Filter by role' })).toBeVisible();
  });
});
