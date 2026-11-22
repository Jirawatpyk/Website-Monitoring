import { expect, test } from '@playwright/test';
import { ensureUser, localSupabaseEnabled, signIn } from './support/local-supabase';

// S20 (FR-15, D-072, D-073, board Reports): the Uptime reports page and a client's PDF, as the seeded
// Admin on the local stack. The seed's sites are watched for 120 days, so every seeded client has a row.
test.describe('Uptime reports (local Supabase)', () => {
  test.skip(!localSupabaseEnabled, 'needs the local Supabase stack: E2E_LOCAL_SUPABASE=1');

  test('the month switch, a row per client, Send off with its reason, the PDF opens', async ({
    page,
    context,
    baseURL,
  }, info) => {
    await ensureUser('tao@example.test');
    await signIn(context, baseURL!, 'tao@example.test');
    // the page never calls the PDF route by itself (no prefetch: each call prints a PDF)
    const pdfCalls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/reports/')) pdfCalls.push(r.url());
    });
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: 'Uptime reports', level: 1 })).toBeAttached();
    await expect(page.getByText(/^Figures as of /)).toBeVisible();
    await expect(page.getByText('Incidents clients see')).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Client reports · / })).toBeVisible();

    // the internal client never gets a report
    await expect(page.getByRole('link', { name: /— Internal,/ })).toHaveCount(0);

    // the running month: a live preview on demand
    await page
      .getByRole('radio', { name: /\d{4}$/ })
      .last()
      .click();
    await expect(page).toHaveURL(/month=\d{4}-\d{2}/);
    await expect(page.getByText('Preview draft · generated on demand')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(pdfCalls, 'no PDF printed by viewing the page').toEqual([]);

    // from xl a table row carries the actions; below it a card opens a sheet with them (MReports, §42)
    const phone = info.project.name === 'mobile';
    let scope;
    if (phone) {
      await page
        .getByRole('button', { name: /Show details$/ })
        .first()
        .click();
      scope = page.getByRole('dialog');
      await expect(scope).toContainText('Sending from here comes later');
    } else {
      scope = page
        .locator('tr:visible')
        .filter({ has: page.getByRole('link', { name: /opens in a new tab/ }) })
        .first();
    }
    const send = scope.getByRole('button', { name: 'Send' });
    await expect(send).toBeDisabled();
    if (!phone) await expect(send).toHaveAttribute('title', /Sending from here comes later/);

    const href = await scope
      .getByRole('link', { name: /opens in a new tab/ })
      .first()
      .getAttribute('href');
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('application/pdf');
    expect(res.headers()['cache-control']).toBe('private, no-store');
    expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('the PDF route refuses a bad month and an unknown client', async ({ page, context, baseURL }) => {
    await ensureUser('tao@example.test');
    await signIn(context, baseURL!, 'tao@example.test');
    const bad = await page.request.get('/api/reports/00000000-0000-4000-8000-000000000000/2026-13');
    expect(bad.status()).toBe(404);
    const month = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 7);
    const unknown = await page.request.get(`/api/reports/00000000-0000-4000-8000-000000000000/${month}`);
    expect(unknown.status()).toBe(404);
  });
});
