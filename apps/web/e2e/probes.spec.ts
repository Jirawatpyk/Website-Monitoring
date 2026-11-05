import { expect, expect as baseExpect, test } from '@playwright/test';
import {
  ensureUser,
  localSupabaseEnabled,
  newHandCheckSite,
  recoveredIncidentOn,
  setBeat,
  signIn,
} from './support/local-supabase';

// S12a (spec §14.4, §15.3, D-053): with the engine cron's sweep 20 min old the Overview shows the fault
// banner and "statuses as of", desktop and phone (Done-when 4); /probes lists every heartbeat and the
// engine row is down. S12b (spec §30, D-055): the hand check, the manual incident and Escalate now —
// in this file because they age the same beats. Local Supabase only (E2E_LOCAL_SUPABASE=1, after `pnpm db:reset`).
test.describe('monitor fault and Probes (local Supabase)', () => {
  test.skip(!localSupabaseEnabled, 'needs the local Supabase stack: E2E_LOCAL_SUPABASE=1');
  // Both tests age the same row. While they run, another file reading the Overview in parallel sees
  // the fault banner (none asserts its absence today). Afterwards the row goes: a sweep that never ran
  // is no fault, whereas a fresh stamp would age into one with no cron locally.
  test.describe.configure({ mode: 'serial' });
  // The beats are cleared once, after every project (e2e/global-teardown.ts).

  test('Done-when 4: the Overview shows the fault banner and as-of data', async ({
    page,
    context,
    baseURL,
  }, info) => {
    await ensureUser('tao@example.test');
    await setBeat('engine-sweep', new Date(Date.now() - 20 * 60_000));
    await signIn(context, baseURL!, 'tao@example.test');
    await page.goto('/');
    const banner = page.getByText(/^Monitoring is degraded — /).locator('visible=true');
    await expect(banner).toBeVisible();
    await expect(
      page.getByText(/The status engine’s sweep hasn’t run since \d\d:\d\d/).locator('visible=true'),
    ).toBeVisible();
    await expect(
      page
        .getByText(/missed > 3 min, from \d\d:\d\d → Healthchecks\.io emails the Admins/)
        .locator('visible=true'),
    ).toBeVisible();
    await expect(page.getByText(/Heartbeat missed 2\d min/).locator('visible=true')).toBeVisible();
    await page.screenshot({
      path: `test-results/s12a-overview-fault-${info.project.name}.png`,
      fullPage: true,
    });
    await page.getByRole('link', { name: 'Open probes & heartbeat' }).locator('visible=true').click();
    // the first visit compiles the route on the dev server
    await expect(page).toHaveURL(/\/probes$/, { timeout: 30_000 });
  });

  test('Probes lists every heartbeat; the stale engine row is down', async ({
    page,
    context,
    baseURL,
  }, info) => {
    await setBeat('engine-sweep', new Date(Date.now() - 20 * 60_000));
    await signIn(context, baseURL!, 'tao@example.test');
    await page.goto('/probes');
    await expect(page.getByRole('heading', { level: 1, name: 'Probes & heartbeat' })).toBeAttached();
    for (const name of [
      'engine',
      'notifier',
      'probe-bkk',
      'probe-sin',
      'probe-tyo',
      'browser-verifier',
      'vps-watchdog',
      'crawler',
    ])
      await expect(page.getByRole('cell', { name, exact: true })).toBeVisible();
    await expect(page.getByRole('row', { name: /^engine / })).toContainText('Down');
    await expect(page.getByText(/heartbeats? missed · engine/)).toBeVisible();
    await page.screenshot({ path: `test-results/s12a-probes-${info.project.name}.png`, fullPage: true });
  });

  test('Loads OK, Down — open incident, Escalate now · L1', async ({ page, context, baseURL }, info) => {
    // Three server actions and their refreshes on the dev server, beside the other specs.
    test.setTimeout(90_000);
    // Each press refreshes the page from the server: slow on the dev server beside the other specs.
    const expect = baseExpect.configure({ timeout: 20_000 });
    await ensureUser('tao@example.test');
    const site = await newHandCheckSite('arm@example.test', 'bua@example.test');
    const old = new Date(Date.now() - 10 * 60_000);
    await setBeat('engine-sweep', old);
    await setBeat('engine-run', old);
    await signIn(context, baseURL!, 'tao@example.test');

    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Hand check · Tier 1' }).locator('visible=true'),
    ).toBeVisible();
    await page
      .getByRole('button', { name: `Loads OK · ${site}` })
      .locator('visible=true')
      .click();
    await expect(
      page
        .getByText(/^Checked OK · .+ \d\d:\d\d$/)
        .locator('visible=true')
        .first(),
    ).toBeVisible();
    await page.screenshot({ path: `test-results/s12b-hand-check-${info.project.name}.png`, fullPage: true });

    await page
      .getByRole('button', { name: `Down — open incident · ${site}` })
      .locator('visible=true')
      .click();
    const dialog = page.getByRole('dialog', { name: `Open an incident for ${site}?` });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/What did you see/).fill('Home page shows a 502 error');
    await expect(dialog.getByText('27 / 500 · optional — shown on the incident timeline')).toBeVisible();
    await dialog.getByRole('button', { name: 'Open incident' }).click();
    // §30.2: it stays on the Overview, and the row links the new incident.
    const opened = page
      .locator('li, [role="row"]')
      .filter({ hasText: site })
      .getByRole('link', { name: /^INC-\d+ opened · / })
      .locator('visible=true')
      .first();
    await expect(opened).toBeVisible({ timeout: 15_000 });
    await opened.click();
    // the dev server may still be compiling the incident route
    await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}$/, { timeout: 30_000 });

    await expect(
      page.getByText(/Opened by .+ from a hand check · “Home page shows a 502 error”/).first(),
    ).toBeAttached();
    await expect(
      page
        .getByText(/^Nothing escalates on its own — the status engine is down since \d\d:\d\d/)
        .locator('visible=true'),
    ).toBeVisible();
    await page
      .getByRole('button', { name: /^Escalate now · L1/ })
      .locator('visible=true')
      .click();
    const confirm = page.getByRole('dialog', { name: 'Send L1 now?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: /^Send L1/ }).click();
    await expect(confirm).toBeHidden({ timeout: 30_000 });
    // the refresh after the send can be slow on the dev server
    await expect(
      page
        .getByText(/^Sent \d\d:\d\d by /)
        .locator('visible=true')
        .first(),
    ).toBeVisible({ timeout: 15_000 });
    await page.screenshot({
      path: `test-results/s12b-escalate-now-${info.project.name}.png`,
      fullPage: true,
    });
  });

  test('Down again on a recovered incident (D-055 item 7)', async ({ page, context, baseURL }, info) => {
    test.setTimeout(90_000);
    const expect = baseExpect.configure({ timeout: 20_000 });
    await ensureUser('tao@example.test');
    const site = await newHandCheckSite('arm@example.test', 'bua@example.test');
    const incidentId = await recoveredIncidentOn(site);
    const old = new Date(Date.now() - 10 * 60_000);
    await setBeat('engine-sweep', old);
    await setBeat('engine-run', old);
    await signIn(context, baseURL!, 'tao@example.test');

    await page.goto('/');
    const row = page.locator('[data-site]').filter({ hasText: site }).locator('visible=true').first();
    await row.scrollIntoViewIfNeeded();
    // §31.1: the open incident is the row's line, beside Loads OK and Down again.
    await expect(row.getByRole('link', { name: /^Open INC-\d+ · Monitoring$/ })).toBeVisible();
    await expect(row.getByRole('button', { name: `Loads OK · ${site}` })).toBeVisible();
    await page.screenshot({
      path: `test-results/s12b-down-again-row-${info.project.name}.png`,
      fullPage: true,
    });
    await page
      .getByRole('button', { name: `Down again · ${site}` })
      .locator('visible=true')
      .click();
    const dialog = page.getByRole('dialog', { name: `Report ${site} down again?` });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/^Posts DOWN AGAIN in INC-\d+’s thread now, @mentioning /)).toBeVisible();
    await expect(dialog.getByText(/^Levels already reached stay: /)).toBeVisible();
    await page.screenshot({ path: `test-results/s12b-down-again-dialog-${info.project.name}.png` });
    await dialog.getByLabel(/What did you see/).fill('502 again');
    await dialog.getByRole('button', { name: 'Report down' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    // Down again once: the incident is down, so the button goes.
    await expect(
      page.getByRole('button', { name: `Down again · ${site}` }).locator('visible=true'),
    ).toHaveCount(0, { timeout: 15_000 });
    // The row says what happened, and focus lands on it (the button that opened the dialog is gone).
    await expect(row.getByRole('link', { name: /^INC-\d+ reported down · / })).toBeFocused();
    await page.screenshot({
      path: `test-results/s12b-down-again-after-${info.project.name}.png`,
      fullPage: true,
    });

    await page.goto(`/incidents/${incidentId}`);
    await expect(
      page.getByText(/^Down again, reported by .+ from a hand check · “502 again”$/).first(),
    ).toBeAttached({ timeout: 30_000 });
    await page.screenshot({ path: `test-results/s12b-down-again-${info.project.name}.png`, fullPage: true });
  });
});
