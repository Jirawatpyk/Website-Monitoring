import { expect, test } from '@playwright/test';
import { ensureUser, localSupabaseEnabled, signIn } from './support/local-supabase';

// S15 (FR-13, D-061): the Audit log page. Read only — nothing here writes, so it runs in both projects.
// Local Supabase only (E2E_LOCAL_SUPABASE=1). The seed and the other specs leave plenty of entries.
test.describe('audit log (local Supabase)', () => {
  test.skip(!localSupabaseEnabled, 'needs the local Supabase stack: E2E_LOCAL_SUPABASE=1');

  test('an Admin filters by category; the CSV holds the filtered rows only (Done-when 2)', async ({
    page,
    context,
    baseURL,
  }, info) => {
    await ensureUser('tao@example.test');
    await signIn(context, baseURL!, 'tao@example.test');
    await page.goto('/audit?when=all');
    await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeAttached();
    // A longer range alone narrows nothing inside it: no "filtered from" yet (spec-checker L4).
    // The page streams the newest 500 rows while every other spec writes audit rows: on a busy laptop
    // the first paint took past 10 s (23 Nov 2026).
    await expect(page.getByText(/entr(y|ies) · all time/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/filtered from/)).toHaveCount(0);

    if (info.project.name === 'mobile') {
      // MAuditLog §33.4: Category is a select on a phone.
      // A touch screen (coarse pointer) gets the native picker: choose on the <select> itself.
      await page.locator('select.aura-select__native').first().selectOption({ label: 'Maintenance & mute' });
    } else await page.getByRole('radio', { name: 'Maintenance & mute' }).click();
    await expect(page).toHaveURL(/cat=maintenance/);
    // "No entries" when no maintenance spec has run yet (a fresh `db:reset`: this spec ran first and
    // failed on "No entries · all time · filtered from 99", 23 Nov 2026)
    const count = page.getByText(/^(No|\d[\d,]*) entr(y|ies) · all time/);
    await expect(count).toBeVisible({ timeout: 20_000 }); // the filtered page streams again
    const head = (await count.textContent())!.match(/^(No|[\d,]+)/)![1]!;
    const shown = head === 'No' ? 0 : Number(head.replace(/,/g, ''));
    await expect(
      page.getByRole('link', { name: `Export ${shown} ${shown === 1 ? 'row' : 'rows'}` }),
    ).toBeVisible();
    if (info.project.name === 'mobile' && shown > 0) {
      // §33.6–7: cards, never a table; a card opens the entry in full.
      await expect(page.getByRole('table')).toBeHidden();
      await page
        .getByRole('button', { name: /Open the full entry$/ })
        .first()
        .click();
      const sheet = page.getByRole('dialog');
      await expect(sheet).toContainText('(UTC+7)');
      await expect(sheet).toContainText('Can’t be edited or deleted.');
      await sheet.getByRole('button', { name: 'Close', exact: true }).first().click();
    }

    const res = await page.request.get('/audit/export?cat=maintenance&when=all');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-disposition']).toContain('audit-log.csv');
    const lines = (await res.text()).trimEnd().split('\r\n');
    expect(lines[0]).toBe('Time (Bangkok),Actor,Action,What,Entity,Before,After,Before (JSON),After (JSON)');
    // Every exported row is in the category, and there are as many as the page counts.
    const actions = lines.slice(1).map((l) => l.split(',')[2]);
    expect(actions.every((a) => /^(maintenance\.|site\.mute)/.test(a ?? ''))).toBe(true);
    // at least what the page counted: maintenance specs running beside this one may add rows in between
    expect(lines.length - 1).toBeGreaterThanOrEqual(shown);

    await page.getByRole('button', { name: 'Clear filters' }).first().click();
    await expect(page).toHaveURL(/\/audit$/);
  });

  test('a Responder gets No access, and the export refuses them', async ({ page, context, baseURL }) => {
    await ensureUser('arm@example.test');
    await signIn(context, baseURL!, 'arm@example.test');
    await page.goto('/audit');
    await expect(page.getByText('Only Admins can see the audit log')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('table')).toHaveCount(0);
    const res = await page.request.get('/audit/export');
    expect(res.status()).toBe(403);
  });
});
