import { expect, test } from '@playwright/test';
import {
  ensureUser,
  fireClientUpdate,
  localSupabaseEnabled,
  openTestIncident,
  signIn,
} from './support/local-supabase';

// S11 (FR-20, spec §9, §16.6, D-052): the Client update card once the track fired — the AM, the TH / EN
// draft, Mark client updated with a note, Not needed with a reason, and the Resolve condition. Local
// Supabase only (E2E_LOCAL_SUPABASE=1, after `pnpm db:reset`); each test opens its own `E2E …` site.
test.describe('client update (local Supabase)', () => {
  test.skip(!localSupabaseEnabled, 'needs the local Supabase stack: E2E_LOCAL_SUPABASE=1');
  test.describe.configure({ mode: 'serial' });

  test('Bua, the client’s AM, marks it with a note; the condition is met', async ({
    page,
    context,
    baseURL,
  }, info) => {
    await ensureUser('arm@example.test');
    await ensureUser('bua@example.test');
    const id = await openTestIncident('arm@example.test', { ageMinutes: 16 });
    const client = await fireClientUpdate(id, 'bua@example.test');
    await signIn(context, baseURL!, 'bua@example.test');
    await page.goto(`/incidents/${id}`);

    const card = page.getByRole('region', { name: 'Client update' }).filter({ visible: true }).first();
    const scope = (await card.count()) ? card : page;
    await expect(
      scope
        .getByText(/^Due \d\d:\d\d$/)
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    await expect(
      scope.getByText(`เรียนทีม ${client}`, { exact: false }).filter({ visible: true }).first(),
    ).toBeVisible();
    await page.getByRole('radio', { name: 'EN' }).filter({ visible: true }).first().click();
    await expect(
      page.getByText(`Hi ${client} team,`, { exact: false }).filter({ visible: true }).first(),
    ).toBeVisible();
    if (info.project.name !== 'mobile') {
      await expect(page.getByText(/^Client update due \d\d:\d\d · Bua notified/)).toBeVisible();
    }
    await page.screenshot({ path: info.outputPath('client-update-due.png'), fullPage: true });

    await page.getByRole('button', { name: 'Mark client updated' }).filter({ visible: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Mark client updated' });
    await dialog.getByLabel(/Note/).fill('Called the client’s ops, ETA shared');
    await dialog.getByRole('button', { name: 'Mark updated' }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page
        .getByText(/Marked by Bua \d\d:\d\d/)
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Mark client updated' }).filter({ visible: true }),
    ).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('client-update-marked.png'), fullPage: true });
  });

  test('Not needed needs a reason; a Viewer sees the card without buttons', async ({
    page,
    context,
    baseURL,
  }) => {
    await ensureUser('arm@example.test');
    await ensureUser('mint@example.test');
    const id = await openTestIncident('arm@example.test', { ageMinutes: 16 });
    await fireClientUpdate(id, 'bua@example.test');

    await signIn(context, baseURL!, 'mint@example.test');
    await page.goto(`/incidents/${id}`);
    await expect(
      page
        .getByText(/Bua, the site’s owner or an Admin marks it/)
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Mark client updated' }).filter({ visible: true }),
    ).toHaveCount(0);

    await context.clearCookies();
    await signIn(context, baseURL!, 'arm@example.test');
    await page.goto(`/incidents/${id}`);
    await page.getByRole('button', { name: 'Not needed…' }).filter({ visible: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Client update not needed' });
    await expect(dialog.getByRole('button', { name: 'Mark not needed' })).toBeDisabled();
    await dialog.getByLabel(/Reason/).fill('The client reported it to us first');
    await dialog.getByRole('button', { name: 'Mark not needed' }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByText('Not needed', { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
  });
});
