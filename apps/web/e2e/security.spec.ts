import { expect, test } from '@playwright/test';
import { ensurePerson, ensureUser, localSupabaseEnabled, signIn } from './support/local-supabase';

// S16 PR 3 (D-062 items 5, 12): Settings › Sign-in & security. Local Supabase only. The person signed
// out is the spec's own (e2e-signout@…), so no other spec running alongside loses its session.
test.describe('sign-in & security (local Supabase)', () => {
  test.skip(!localSupabaseEnabled, 'needs the local Supabase stack: E2E_LOCAL_SUPABASE=1');

  test('an Admin signs someone out everywhere: their browser is refused at once, and it is logged (Done-when 3)', async ({
    page,
    context,
    browser,
    baseURL,
  }, info) => {
    test.skip(info.project.name === 'mobile', 'view only on phones (§22.5)');
    const person = await ensurePerson('e2e-signout@example.test', 'responder');

    // Their own browser, signed in.
    const theirs = await browser.newContext();
    await signIn(theirs, baseURL!, 'e2e-signout@example.test');
    const them = await theirs.newPage();
    await them.goto('/');
    await expect(them).not.toHaveURL(/\/login/);

    await ensureUser('tao@example.test');
    await signIn(context, baseURL!, 'tao@example.test');
    await page.goto('/settings/security');
    await expect(page.getByRole('heading', { name: 'Who can sign in' })).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: person.name });
    await row.getByRole('button', { name: /^Sign out all of / }).click();
    const dialog = page.getByRole('dialog', { name: `Sign out ${person.name} everywhere?` });
    await expect(dialog.getByText('Their role and alerts don’t change.', { exact: false })).toBeVisible();
    await dialog.getByRole('button', { name: /^Sign out \d+ devices?$/ }).click();
    await expect(page.getByTestId('security-status')).toHaveText(
      new RegExp(`^${person.name} signed out on \\d+ devices? · logged$`),
    );
    await expect(row.getByText(/^Signed out · \d\d:\d\d$/)).toBeVisible();
    await expect(row.getByRole('button', { name: /^Sign out all of / })).toHaveCount(0);
    // Focus goes to the section heading once the row's button is gone.
    await expect(page.getByRole('heading', { name: 'People and their sign-in' })).toBeFocused();

    // Their next page is refused: the session is gone (`my_access` → ended), so it's the sign-in page.
    await them.goto('/');
    await expect(them).toHaveURL(/\/login/);
    await theirs.close();

    await page.goto('/audit?cat=access&when=today');
    await expect(page.getByText('Signed out everywhere').filter({ visible: true }).first()).toBeVisible();
    // The events card says it as a sentence.
    await page.goto('/settings/security');
    await expect(
      page
        .getByText(`signed ${person.name} out everywhere`, { exact: false })
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
  });

  test('a Responder gets No access', async ({ page, context, baseURL }) => {
    await ensureUser('arm@example.test');
    await signIn(context, baseURL!, 'arm@example.test');
    await page.goto('/settings/security');
    await expect(page.getByText('Only Admins can see Settings')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to Overview', exact: true })).toBeVisible();
  });

  test('phone: view only — cards, a sheet with your devices (§35.6)', async ({
    page,
    context,
    baseURL,
  }, info) => {
    test.skip(info.project.name !== 'mobile', 'the phone layout');
    await ensureUser('tao@example.test');
    await signIn(context, baseURL!, 'tao@example.test');
    await page.goto('/settings/security');
    await expect(page.getByText('View only on phones.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'WHO CAN SIGN IN' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Sign out/ })).toHaveCount(0);
    await page
      .getByRole('button', { name: /^Jirawat .*Admin.*Show devices$|^Tao, Admin.*Show devices$/ })
      .first()
      .click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('This device')).toBeVisible();
    await expect(
      sheet.getByText('Signing someone out happens on a larger screen.', { exact: false }),
    ).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('security-sheet-390.png') });
    await sheet.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(page.getByRole('link', { name: 'All sign-in events in the Audit log' })).toBeVisible();
  });
});
