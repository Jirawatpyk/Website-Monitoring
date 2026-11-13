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
    test.skip(info.project.name !== 'desktop', 'the 390 layout waits for the MAuditLog board (D-061 item 5)');
    await ensureUser('tao@example.test');
    await signIn(context, baseURL!, 'tao@example.test');
    await page.goto('/audit?when=all');
    await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeAttached();
    // A longer range alone narrows nothing inside it: no "filtered from" yet (spec-checker L4).
    await expect(page.getByText(/entr(y|ies) · all time/)).toBeVisible();
    await expect(page.getByText(/filtered from/)).toHaveCount(0);

    await page.getByRole('radio', { name: 'Maintenance & mute' }).click();
    await expect(page).toHaveURL(/cat=maintenance/);
    const count = page.getByText(/^\d[\d,]* entr(y|ies) · all time/);
    await expect(count).toBeVisible();
    const shown = Number((await count.textContent())!.match(/^([\d,]+)/)![1]!.replace(/,/g, ''));
    await expect(
      page.getByRole('link', { name: `Export ${shown} ${shown === 1 ? 'row' : 'rows'}` }),
    ).toBeVisible();

    const res = await page.request.get('/audit/export?cat=maintenance&when=all');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-disposition']).toContain('audit-log.csv');
    const lines = (await res.text()).trimEnd().split('\r\n');
    expect(lines[0]).toBe('Time (Bangkok),Actor,Action,What,Entity,Before,After,Before (JSON),After (JSON)');
    // Every exported row is in the category, and there are as many as the page counts.
    const actions = lines.slice(1).map((l) => l.split(',')[2]);
    expect(actions.every((a) => /^(maintenance\.|site\.mute)/.test(a ?? ''))).toBe(true);
    expect(lines.length - 1).toBe(shown);

    await page.getByRole('button', { name: 'Clear filters' }).first().click();
    await expect(page).toHaveURL(/\/audit$/);
  });

  test('a Responder gets No access, and the export refuses them', async ({ page, context, baseURL }) => {
    await ensureUser('arm@example.test');
    await signIn(context, baseURL!, 'arm@example.test');
    await page.goto('/audit');
    await expect(page.getByText('The audit log is for Admins')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    const res = await page.request.get('/audit/export');
    expect(res.status()).toBe(403);
  });
});
