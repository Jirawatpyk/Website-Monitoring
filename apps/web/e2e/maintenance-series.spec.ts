import { expect, test } from '@playwright/test';
import { ensureUser, localSupabaseEnabled, openTestIncident, signIn, siteOf } from './support/local-supabase';

// S14 PR 2c-2 (spec §32.2–7, 7a; D-057): repeating maintenance on /maintenance — an Admin schedules a
// weekly series, it shows under Repeating series, Cancel → Undo brings it back; a Responder asks for a
// series, an Admin approves it (Undo, approve again). Local Supabase only (E2E_LOCAL_SUPABASE=1).
test.describe('repeating maintenance (local Supabase)', () => {
  test.skip(!localSupabaseEnabled, 'needs the local Supabase stack: E2E_LOCAL_SUPABASE=1');

  test('an Admin schedules a weekly series; Cancel series → Undo', async ({
    page,
    context,
    baseURL,
  }, info) => {
    await ensureUser('tao@example.test');
    const site = await siteOf(await openTestIncident('tao@example.test'));
    await signIn(context, baseURL!, 'tao@example.test');
    await page.goto('/maintenance');
    await page.getByRole('button', { name: 'Schedule maintenance or mute' }).first().click();
    const dialog = page.getByRole('dialog', { name: /^Schedule (repeating )?maintenance$/ });
    await dialog.getByRole('combobox', { name: 'Site' }).click();
    await page.getByRole('option', { name: new RegExp(`^${site.name} · Tier`) }).click();
    // Repeat: a segmented control from md, a select on phones (§32.3).
    if (info.project.name === 'mobile') {
      await dialog.getByRole('combobox', { name: 'Repeat' }).click();
      await page.getByRole('option', { name: 'Weekly' }).click();
    } else {
      await dialog.getByRole('radio', { name: 'Weekly' }).click();
    }
    await expect(page.getByRole('dialog', { name: 'Schedule repeating maintenance' })).toBeVisible();
    // The window's 22:00 / 4 h carry over to the series (board Maintenance).
    await expect(
      dialog.getByText(/^Every \w{3} \d{2}:\d{2} → \d{2}:\d{2}( next day)? \(UTC\+7\) · from /),
    ).toBeVisible();
    // Weekdays too, so the row's When is a long rule ("Every Mon, Tue, Wed, Thu, Fri …") that must wrap.
    for (const d of ['Mon', 'Tue', 'Thu', 'Fri']) {
      const chip = dialog.getByRole('button', { name: d, exact: true });
      if ((await chip.getAttribute('aria-pressed')) !== 'true') await chip.click();
    }
    await expect(dialog.getByText(/^Every Mon, Tue, \w{3}/)).toBeVisible();
    await page.screenshot({
      path: `test-results/s14-series-dialog-${info.project.name}.png`,
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    // Let the colour transitions finish before the capture.
    await page.waitForTimeout(600);
    await page.screenshot({ path: `test-results/s14-series-dialog-${info.project.name}-dark.png` });
    await page.emulateMedia({ colorScheme: 'light' });
    await dialog.getByLabel(/Reason/).fill(`E2E series ${info.project.name}`);
    await dialog.getByRole('button', { name: 'Schedule series' }).click();
    await expect(dialog.getByText(`Series scheduled · ${site.name}`)).toBeVisible();
    await dialog.getByRole('button', { name: 'Done' }).click();

    const series = page.getByRole('region', { name: 'Repeating series' });
    await expect(
      (info.project.name === 'mobile'
        ? series.getByRole('button', { name: new RegExp(site.name) })
        : series.getByRole('row', { name: new RegExp(site.name) })
      ).first(),
    ).toBeVisible();
    await page.screenshot({ path: `test-results/s14-series-page-${info.project.name}.png`, fullPage: true });
    if (info.project.name === 'desktop') {
      // Dark, and the 820 phone list (below xl the row cards show).
      await page.emulateMedia({ colorScheme: 'dark' });
      await series.scrollIntoViewIfNeeded();
      await page.screenshot({ path: 'test-results/s14-series-page-desktop-dark.png' });
      await page.setViewportSize({ width: 820, height: 1100 });
      await series.scrollIntoViewIfNeeded();
      await page.screenshot({ path: 'test-results/s14-series-page-820-dark.png' });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.emulateMedia({ colorScheme: 'light' });
    }
    if (info.project.name === 'mobile') {
      await series
        .getByRole('button', { name: new RegExp(site.name) })
        .first()
        .click();
      await page
        .getByRole('dialog', { name: site.name })
        .getByRole('button', { name: 'Cancel series…' })
        .click();
    } else {
      await series
        .getByRole('row', { name: new RegExp(site.name) })
        .getByRole('button', { name: 'Cancel series…' })
        .click();
    }
    const cancel = page.getByRole('dialog', { name: `Cancel the ${site.name} series?` });
    await expect(cancel.getByText(/^Cancels the \d+ occurrences? that haven’t started/)).toBeVisible();
    await cancel.getByLabel(/Reason/).fill('E2E: not needed');
    await cancel.getByRole('button', { name: 'Cancel series' }).click();
    await expect(
      page.getByText(new RegExp(`^${site.name} series cancelled · \\d+ windows? cancelled$`)),
    ).toBeVisible();
    await page.getByRole('button', { name: /^Undo · \d+ s$/ }).click();
    await expect(page.getByText(`${site.name} series cancelled — undone`)).toBeVisible();
    await expect(
      (info.project.name === 'mobile'
        ? series.getByRole('button', { name: new RegExp(site.name) })
        : series.getByRole('row', { name: new RegExp(site.name) })
      ).first(),
    ).toBeVisible();
  });

  test('a Responder asks for a series; an Admin approves it (Undo, then approve)', async ({
    browser,
    page,
    context,
    baseURL,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'one run is enough; the phone layout is in the first test');
    await ensureUser('arm@example.test');
    await ensureUser('tao@example.test');
    const site = await siteOf(await openTestIncident('arm@example.test'));
    await signIn(context, baseURL!, 'arm@example.test');
    await page.goto('/maintenance');
    await page.getByRole('button', { name: 'Schedule maintenance or mute' }).first().click();
    const dialog = page.getByRole('dialog', { name: /^Schedule (repeating )?maintenance$/ });
    await dialog.getByRole('combobox', { name: 'Site' }).click();
    await page.getByRole('option', { name: new RegExp(`^${site.name} · Tier`) }).click();
    await dialog.getByRole('radio', { name: 'Weekly' }).click();
    // One warning per width: before Reason on phones, after it from md (§32.3, board).
    await expect(
      dialog.getByText('Needs an Admin’s approval', { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await dialog.getByLabel(/Reason/).fill('E2E series request');
    await dialog.getByRole('button', { name: 'Ask for approval' }).click();
    await expect(dialog.getByText(new RegExp(`^Series request sent to .* · ${site.name}$`))).toBeVisible();
    await dialog.getByRole('button', { name: 'Done' }).click();
    const mine = page
      .getByRole('region', { name: 'Waiting for approval' })
      .getByRole('row', { name: new RegExp(site.name) });
    // The row arrives with the page's refresh after Done: slow with many E2E rows and parallel workers.
    await expect(mine.getByRole('button', { name: 'Withdraw…' })).toBeVisible({ timeout: 15_000 });

    const tao = await browser.newContext();
    await signIn(tao, baseURL!, 'tao@example.test');
    const admin = await tao.newPage();
    await admin.goto(`${baseURL}/maintenance`);
    const row = admin
      .getByRole('region', { name: 'Waiting for approval' })
      .getByRole('row', { name: new RegExp(site.name) });
    await row.getByRole('button', { name: 'Approve' }).click();
    const confirm = admin.getByRole('dialog', { name: `Approve the ${site.name} series?` });
    await expect(confirm.getByText(/^Windows are created 14 days ahead — the first \d now: /)).toBeVisible();
    await confirm.getByRole('button', { name: 'Approve series' }).click();
    await admin.getByRole('button', { name: /^Undo · \d+ s$/ }).click();
    await expect(admin.getByText(`${site.name} series approval undone`)).toBeVisible();
    await expect(row.getByRole('button', { name: 'Approve' })).toBeVisible();
    await row.getByRole('button', { name: 'Approve' }).click();
    await confirm.getByRole('button', { name: 'Approve series' }).click();
    await expect(
      admin.getByRole('region', { name: 'Repeating series' }).getByText(site.name).first(),
    ).toBeVisible();
    await admin.screenshot({ path: 'test-results/s14-series-approved-admin.png', fullPage: true });
    await tao.close();
  });
});
