import { expect, test } from '@playwright/test';
import { ensureUser, escalationAudit, localSupabaseEnabled, signIn } from './support/local-supabase';

// S08 (D-034): an Admin edits L1, a step under +15 min is refused with the board's words, a fixed
// step saves with a note and leaves one audit row; a Responder sees the policies read-only.
// Local Supabase only (E2E_LOCAL_SUPABASE=1, after `pnpm db:reset`).
test.describe('escalation policies (local Supabase)', () => {
  test.skip(!localSupabaseEnabled, 'needs the local Supabase stack: E2E_LOCAL_SUPABASE=1');

  test('Admin: +10 refused, +20 saved with a note, one audit row', async ({
    page,
    context,
    baseURL,
  }, info) => {
    test.skip(
      info.project.name !== 'desktop',
      'the editor is desktop and tablet (phones are view only, §22)',
    );
    await ensureUser('tao@example.test');
    await signIn(context, baseURL!, 'tao@example.test');
    const before = await escalationAudit();
    await page.goto('/escalation');
    await expect(page.getByRole('heading', { level: 1, name: 'Escalation policies' })).toBeVisible();

    const editor = page.locator('div.hidden.md\\:block');
    await editor.getByRole('button', { name: 'Edit L1' }).click();
    const dialog = page.getByRole('dialog', { name: /Edit L1 · Tier 1 DOWN/ });
    // A run stopped half way leaves L1 at +20 (a CI retry would meet it): change it to something new.
    const target = (await dialog.getByLabel('Notify after').inputValue()) === '20' ? '25' : '20';
    await dialog.getByLabel('Notify after').fill('10');
    await expect(dialog.getByText('At least +15 min — L0 covers the first 15 minutes')).toBeVisible();
    await dialog.getByLabel('Notify after').fill(target);
    await dialog.getByRole('button', { name: 'Apply to L1' }).click();

    const bar = page.getByRole('region', { name: 'Unsaved changes' });
    await expect(bar).toContainText('1 unsaved change');
    await bar.getByRole('button', { name: 'Save' }).click();
    const save = page.getByRole('dialog', { name: 'Save escalation changes?' });
    await expect(save).toContainText(
      new RegExp(`\\+${target} min · Backup \\+ Admin \\(.+\\) · Chat @mention, Email`),
    );
    await save.getByRole('button', { name: 'Save and log' }).click();
    await expect(save.getByText('Add a short note — it goes in the audit log with the change')).toBeVisible();
    await save.getByLabel(/Change note/).fill('E2E: L1 a little later');
    await save.getByRole('button', { name: 'Save and log' }).click();
    await expect(bar).toBeHidden();
    await expect(editor.getByText(`+${target} min`)).toBeVisible();
    await expect.poll(escalationAudit).toBe(before + 1);

    // Back to the seed, so other runs start from it.
    await editor.getByRole('button', { name: 'Edit L1' }).click();
    await page.getByLabel('Notify after').fill('15');
    await page.getByRole('button', { name: 'Apply to L1' }).click();
    await bar.getByRole('button', { name: 'Save' }).click();
    await save.getByLabel(/Change note/).fill('E2E: back to the seed');
    await save.getByRole('button', { name: 'Save and log' }).click();
    await expect(bar).toBeHidden();
  });

  test('Admin on a phone: view only (spec §22.5), no edit controls', async ({
    page,
    context,
    baseURL,
  }, info) => {
    test.skip(info.project.name !== 'mobile', 'the phone layout');
    await ensureUser('tao@example.test');
    await signIn(context, baseURL!, 'tao@example.test');
    await page.goto('/escalation');
    await expect(page.getByText('View only on phones.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Edit L1|Delete L1/ })).toBeHidden();
    await page.getByRole('radio', { name: 'PROBLEM' }).click();
    await expect(page.getByRole('heading', { name: /^PROBLEM · all \d+ sites?$/ })).toBeVisible();
  });

  test('Responder: the policies read-only, no edit controls', async ({ page, context, baseURL }) => {
    await ensureUser('arm@example.test');
    await signIn(context, baseURL!, 'arm@example.test');
    await page.goto('/escalation');
    await expect(page.getByText('Only an Admin can change escalation policies.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Edit L1|Save/ })).toHaveCount(0);
    await expect(page.getByText('EXAMPLE · NOBODY ACKNOWLEDGES')).toBeVisible();
  });
});
