import { expect, test, type Page } from '@playwright/test';
import { ensureUser, localSupabaseEnabled, setActive, signIn } from './support/local-supabase';

/** On a phone the side nav (and its account footer) sits behind "Open navigation". */
async function openNavOnPhone(page: Page) {
  const menu = page.getByRole('button', { name: 'Open navigation' });
  if (await menu.isVisible()) await menu.click();
}

// Login / MLogin states that need no database (desktop 1440 and phone 390 projects).
test.describe('sign-in page states', () => {
  test('keeps the page to return to on the Google link', async ({ page }) => {
    await page.goto('/incidents/x');
    await expect(page).toHaveURL(/\/login\?next=%2Fincidents%2Fx$/);
    await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute(
      'href',
      '/auth/sign-in?next=%2Fincidents%2Fx',
    );
  });

  for (const [error, heading] of [
    ['domain', 'This account can’t sign in'],
    ['access', 'No access yet'],
    ['deactivated', 'Account deactivated'],
  ] as const) {
    test(`?error=${error} shows "${heading}"`, async ({ page }) => {
      await page.goto(`/login?error=${error}`);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Use a different account' })).toBeVisible();
    });
  }

  test('?error=auth shows the sign-in card with what went wrong', async ({ page }) => {
    await page.goto('/login?error=auth');
    await expect(page.getByText('Sign-in didn’t finish')).toBeVisible();
  });

  test('the Google button is at least 44 px tall', async ({ page }) => {
    await page.goto('/login');
    const box = await page.getByRole('link', { name: 'Sign in with Google' }).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  });
});

// Signed-in flows: local Supabase only (E2E_LOCAL_SUPABASE=1, after `pnpm db:reset`).
test.describe('signed in (local Supabase)', () => {
  test.skip(!localSupabaseEnabled, 'needs the local Supabase stack: E2E_LOCAL_SUPABASE=1');
  test.describe.configure({ mode: 'serial' });

  test('an allowlisted account lands on / with its role', async ({ page, context, baseURL }) => {
    await ensureUser('arm@example.test'); // seeded: allowlisted as Responder
    await signIn(context, baseURL!, 'arm@example.test');
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);
    await openNavOnPhone(page);
    await expect(page.getByText('Responder').filter({ visible: true })).toBeVisible();
  });

  test('after sign-in the person goes back to the page they opened', async ({ page, context, baseURL }) => {
    await page.goto('/incidents/x');
    await expect(page).toHaveURL(/\/login\?next=%2Fincidents%2Fx$/);
    await ensureUser('arm@example.test');
    await signIn(context, baseURL!, 'arm@example.test');
    await page.goto('/login?next=%2Fincidents%2Fx');
    // The incident page arrives in S07; the evidence is the URL (S01 Done-when 2). This proves the
    // login page's return; the real Google → /auth/callback → `next` round trip is checked with
    // /verify on staging (real cookies), and the callback's mapping by its unit tests.
    await expect(page).toHaveURL(/\/incidents\/x$/);
  });

  test('an account with no profile is signed out with "No access yet"', async ({
    page,
    context,
    baseURL,
  }) => {
    await ensureUser('stranger@example.test'); // not on the allowlist → no profile
    await signIn(context, baseURL!, 'stranger@example.test');
    await page.goto('/');
    await expect(page).toHaveURL(/\/login\?error=access$/);
    await expect(page.getByText('stranger@example.test')).toBeVisible();
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/); // the session is gone
  });

  test('a deactivated account is signed out with "Account deactivated"', async ({
    page,
    context,
    baseURL,
  }) => {
    const id = await ensureUser('mint@example.test');
    await setActive(id, false);
    try {
      await signIn(context, baseURL!, 'mint@example.test');
      await page.goto('/');
      await expect(page).toHaveURL(/\/login\?error=deactivated$/);
      await expect(page.getByRole('heading', { name: 'Account deactivated' })).toBeVisible();
    } finally {
      await setActive(id, true);
    }
  });

  test('Sign out ends the session', async ({ page, context, baseURL }) => {
    await ensureUser('arm@example.test');
    await signIn(context, baseURL!, 'arm@example.test');
    await page.goto('/');
    await openNavOnPhone(page);
    await page.getByRole('button', { name: 'Sign out' }).filter({ visible: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login\?next=%2F$/);
  });
});
