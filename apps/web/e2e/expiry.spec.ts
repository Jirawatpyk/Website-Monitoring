import { expect, test } from '@playwright/test';
import {
  clearSiteExpiry,
  ensureUser,
  localSupabaseEnabled,
  nthLiveSiteId,
  setSiteExpiry,
  signIn,
} from './support/local-supabase';

const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();

// S13 (FR-11, D-066, board Expiry): the SSL & domains page. One seeded site gets a fixture row: an
// auto-renew certificate 80 days out (plain) and a domain 45 days out (due soon), read just now, so
// Check now is refused inside its minute and never reads a real host. Local Supabase only.
test.describe('SSL & domains (local Supabase)', () => {
  test.skip(!localSupabaseEnabled, 'needs the local Supabase stack: E2E_LOCAL_SUPABASE=1');
  test.describe.configure({ mode: 'serial' });

  let siteId = '';
  test.beforeAll(async ({}, info) => {
    // each project its own site, so one project's cleanup never removes the other's row
    siteId = await nthLiveSiteId(info.project.name === 'mobile' ? 1 : 0);
    const now = new Date().toISOString();
    await setSiteExpiry(siteId, {
      ssl_expires_at: at(80),
      ssl_valid_from: at(-10),
      ssl_read_at: now,
      ssl_checked_at: now,
      ssl_error: null,
      domain: 'e2e.example.test',
      domain_expires_at: at(45),
      domain_source: 'rdap',
      domain_read_at: now,
      domain_checked_at: now,
      domain_error: null,
    });
  });
  test.afterAll(async () => clearSiteExpiry(siteId));

  test('the page lists the site with its days, the filter narrows it, Check now waits its minute', async ({
    page,
    context,
    baseURL,
  }) => {
    await ensureUser('tao@example.test');
    await signIn(context, baseURL!, 'tao@example.test');
    await page.goto('/expiry');
    await expect(page.getByRole('heading', { name: 'SSL & domains', level: 1 })).toBeAttached();
    await expect(page.getByText(/^Checked daily 06:00 · last check /)).toBeVisible();
    await expect(page.getByText('Due within 60 days')).toBeVisible();

    const table = page.getByRole('table', { name: 'Certificate and domain expiry' });
    const row = table.getByRole('row').filter({ hasText: '45' }).first();
    await expect(row).toContainText('80');
    await expect(row).toContainText('Due soon');
    // Soonest first: the fixture's site leads the list.
    await expect(table.getByRole('row').nth(1)).toContainText('Due soon');

    // Within 60 days: only the due rows stay.
    await page.getByRole('radio', { name: 'Within 60 days' }).click();
    // (the badge exactly: "Bangkok" holds "ok" too)
    await expect(table.getByText('OK', { exact: true })).toHaveCount(0);
    await expect(row).toBeVisible();

    // The fixture was read just now: Check now is refused, in words, and nothing is read.
    await page.getByRole('button', { name: 'Check now' }).click();
    await expect(page.getByRole('status').filter({ hasText: /less than a minute ago/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check now' })).toBeEnabled();
  });
});
