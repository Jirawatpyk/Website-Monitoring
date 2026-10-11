import { expect, test } from '@playwright/test';
import { ensureUser, localSupabaseEnabled, openTestIncident, signIn, siteOf } from './support/local-supabase';

// S09 (spec §14.5, §15.1, §23; D-036): maintenance now on a DOWN site is blocked and offers Mute; a
// Responder's 3-day window waits for an Admin, who approves it on /maintenance.
// Local Supabase only (E2E_LOCAL_SUPABASE=1, after `pnpm db:reset`).
test.describe('maintenance & mutes (local Supabase)', () => {
  test.skip(!localSupabaseEnabled, 'needs the local Supabase stack: E2E_LOCAL_SUPABASE=1');

  test('Done-when 2: starting maintenance now on a DOWN site is blocked with the spec text and offers Mute', async ({
    page,
    context,
    baseURL,
  }, info) => {
    await ensureUser('arm@example.test');
    const site = await siteOf(await openTestIncident('arm@example.test'));
    await signIn(context, baseURL!, 'arm@example.test');
    await page.goto(`/sites/${site.id}`);
    await page
      .getByRole('button', { name: /maintenance/i })
      .first()
      .click();

    const dialog = page.getByRole('dialog', { name: 'Schedule maintenance' });
    const guard = dialog.getByRole('alert');
    await expect(guard).toContainText(`${site.name} is DOWN now (INC-`);
    await expect(guard).toContainText(
      'A window started now won’t hide this incident — it stays open and keeps counting.',
    );
    await dialog.getByLabel(/Reason/).fill('Hotfix');
    await expect(dialog.getByRole('button', { name: 'Start now' })).toBeDisabled();
    await page.screenshot({ path: `test-results/s09-guard-${info.project.name}.png` });

    await guard.getByRole('button', { name: 'Mute instead' }).click();
    const mute = page.getByRole('dialog', { name: 'Mute site' });
    await expect(mute.getByRole('status')).toContainText('keeps escalating until someone acknowledges');
    await mute.getByRole('button', { name: 'Mute for 4 h' }).click();
    await expect(mute.getByText(`Muted · ${site.name}`)).toBeVisible();
  });

  test('Done-when 4: a Responder’s 3-day window waits for an Admin, who approves it', async ({
    browser,
    page,
    context,
    baseURL,
  }, info) => {
    test.skip(
      info.project.name !== 'desktop',
      'one run is enough; the phone layout is checked by layout-consistency',
    );
    await ensureUser('arm@example.test');
    await ensureUser('tao@example.test');
    const site = await siteOf(await openTestIncident('arm@example.test'));
    await signIn(context, baseURL!, 'arm@example.test');
    await page.goto('/maintenance');
    await expect(page.getByRole('heading', { level: 1, name: 'Maintenance & mutes' })).toBeVisible();
    await page.getByRole('button', { name: 'Schedule maintenance or mute' }).first().click();

    const dialog = page.getByRole('dialog', { name: 'Schedule maintenance' });
    await expect(dialog).toContainText('Choose a site first');
    await dialog.getByRole('combobox', { name: 'Site' }).click();
    await page.getByRole('option', { name: `${site.name} · Tier 1`, exact: true }).click();
    await dialog.getByRole('radio', { name: 'Later' }).click();
    await dialog.getByRole('radio', { name: '3 days' }).click();
    await expect(dialog.getByText('Needs an Admin’s approval')).toBeVisible();
    await dialog.getByLabel(/Reason/).fill('E2E: move hosting');
    await dialog.getByRole('button', { name: 'Ask for approval' }).click();
    await expect(dialog.getByText(`Waiting for an Admin · ${site.name}`)).toBeVisible();
    await dialog.getByRole('button', { name: 'Done' }).click();

    const waiting = page.getByRole('region', { name: 'Waiting for approval' });
    await expect(waiting.getByRole('link', { name: site.name })).toBeVisible();
    await expect(
      waiting.getByRole('row', { name: new RegExp(site.name) }).getByText('Waiting for an Admin'),
    ).toBeVisible();
    await page.screenshot({ path: 'test-results/s09-waiting-responder.png', fullPage: true });

    // The Admin approves it: it moves to Scheduled.
    const tao = await browser.newContext();
    await signIn(tao, baseURL!, 'tao@example.test');
    const admin = await tao.newPage();
    await admin.goto(`${baseURL}/maintenance`);
    const row = admin
      .getByRole('region', { name: 'Waiting for approval' })
      .getByRole('row', { name: new RegExp(site.name) });
    await row.getByRole('button', { name: 'Approve' }).click();
    const confirm = admin.getByRole('dialog', { name: /Approve 3 days of maintenance\?/ });
    await confirm.getByRole('button', { name: 'Approve' }).click();
    await expect(
      admin.getByRole('region', { name: 'Scheduled' }).getByRole('link', { name: site.name }),
    ).toBeVisible();
    await admin.screenshot({ path: 'test-results/s09-approved-admin.png', fullPage: true });
    await tao.close();
  });
});
