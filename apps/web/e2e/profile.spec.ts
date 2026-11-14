import { expect, test } from '@playwright/test';
import { ensurePerson, ensureUser, localSupabaseEnabled, signIn } from './support/local-supabase';

// S16 PR 3 (D-062 items 6, 12): My profile. Local Supabase only. Each test that signs devices out or
// edits a Chat id has its own person per project (desktop and mobile run side by side), so no other
// test loses its session (code review); the Chat id the spec sets it clears again.
test.describe('my profile (local Supabase)', () => {
  test.skip(!localSupabaseEnabled, 'needs the local Supabase stack: E2E_LOCAL_SUPABASE=1');

  test('sign out one of your other devices: that browser is refused at once', async ({
    page,
    context,
    browser,
    baseURL,
  }, info) => {
    const email = `e2e-profile-out-${info.project.name}@example.test`;
    await ensurePerson(email, 'responder');
    const other = await browser.newContext();
    await signIn(other, baseURL!, email);
    const there = await other.newPage();
    await there.goto('/');
    await expect(there).not.toHaveURL(/\/login/);

    await signIn(context, baseURL!, email);
    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: 'Signed-in devices' })).toBeVisible();
    await expect(page.getByText('This device', { exact: true })).toBeVisible();
    const signOuts = page.getByRole('button', { name: /^Sign out .*last used/ });
    const before = await signOuts.count();
    expect(before).toBeGreaterThan(0);
    // Sign out every other device of this person (earlier runs may have left more).
    for (let i = 0; i < before; i++) {
      await signOuts.first().click();
      // "Signed out · now" shows until the refresh drops the row (component test): the count is the check.
      await expect(signOuts).toHaveCount(before - i - 1);
    }
    await there.goto('/');
    await expect(there).toHaveURL(/\/login/);
    await other.close();
    // This browser stays signed in.
    await page.reload();
    await expect(page.getByText('This device', { exact: true })).toBeVisible();
  });

  test('your own Chat id: add it, then clear it (D-062 item 6)', async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name === 'mobile', 'one run is enough; the dialog is the same at every width');
    await ensurePerson('e2e-profile-chat@example.test', 'responder');
    await signIn(context, baseURL!, 'e2e-profile-chat@example.test');
    await page.goto('/profile');
    await page.getByRole('button', { name: 'Edit Chat id…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Your Google Chat id' });
    await dialog.getByLabel('Chat user id').fill(`9${Date.now()}`);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Your Chat id saved · logged')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit Chat id…' })).toBeFocused();
    await expect(page.getByText('Working').first()).toBeVisible();

    await page.getByRole('button', { name: 'Edit Chat id…' }).click();
    await dialog.getByRole('button', { name: 'Clear Chat id…' }).click();
    await expect(dialog.getByText('Clear your Chat id?')).toBeVisible();
    await dialog.getByRole('button', { name: 'Clear Chat id', exact: true }).click();
    await expect(page.getByText('Your Chat id cleared · logged')).toBeVisible();
    await expect(page.getByText('No Chat id').first()).toBeVisible();
  });

  test('a Viewer sees no test button and no on-call card', async ({ page, context, baseURL }) => {
    await ensureUser('mint@example.test');
    await signIn(context, baseURL!, 'mint@example.test');
    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: 'How alerts reach me' })).toBeVisible();
    await expect(page.getByRole('button', { name: /test alert/i })).toHaveCount(0);
    await expect(page.getByText('MY NEXT ON-CALL SHIFT')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('profile-viewer.png'), fullPage: true });
  });

  test('an Admin: escalation read from the policies, the avatar opens it', async ({
    page,
    context,
    baseURL,
  }, info) => {
    await ensureUser('tao@example.test');
    await signIn(context, baseURL!, 'tao@example.test');
    await page.goto('/');
    if (info.project.name === 'mobile') await page.getByRole('link', { name: 'My profile' }).click();
    else await page.getByRole('link', { name: /^My profile:/ }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByText(/as Admin/).first()).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('profile-admin.png'), fullPage: true });
  });
});
