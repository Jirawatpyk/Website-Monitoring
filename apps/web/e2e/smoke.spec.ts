import { expect, test } from '@playwright/test';

// Signed-out smoke checks that need no database. Signed-in flows arrive with S01 (local Supabase).

test('signed-out visitors are sent to sign-in, keeping where they were going', async ({ page }) => {
  await page.goto('/incidents');
  await expect(page).toHaveURL(/\/login\?next=%2Fincidents$/);
});

test('sign-in page renders without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('security headers are set', async ({ request }) => {
  const response = await request.get('/login');
  const headers = response.headers();
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
});

test('look-alike paths are not public', async ({ page }) => {
  await page.goto('/login-x');
  await expect(page).toHaveURL(/\/login\?next=%2Flogin-x$/);
});
