import { expect, test } from '@playwright/test';
import { clearBeat, ensureUser, localSupabaseEnabled, setBeat, signIn } from './support/local-supabase';

// S12a (spec §14.4, §15.3, D-053): with the engine cron's sweep 20 min old the Overview shows the fault
// banner and "statuses as of", desktop and phone (Done-when 4); /probes lists every heartbeat and the
// engine row is down. Local Supabase only (E2E_LOCAL_SUPABASE=1, after `pnpm db:reset`).
test.describe('monitor fault and Probes (local Supabase)', () => {
  test.skip(!localSupabaseEnabled, 'needs the local Supabase stack: E2E_LOCAL_SUPABASE=1');
  // Both tests age the same row. While they run, another file reading the Overview in parallel sees
  // the fault banner (none asserts its absence today). Afterwards the row goes: a sweep that never ran
  // is no fault, whereas a fresh stamp would age into one with no cron locally.
  test.describe.configure({ mode: 'serial' });
  test.afterAll(async () => {
    if (localSupabaseEnabled) await clearBeat('engine-sweep');
  });

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
      page.getByText(/Healthchecks\.io alerted at \d\d:\d\d/).locator('visible=true'),
    ).toBeVisible();
    await expect(page.getByText(/Heartbeat missed 2\d min/).locator('visible=true')).toBeVisible();
    await page.screenshot({
      path: `test-results/s12a-overview-fault-${info.project.name}.png`,
      fullPage: true,
    });
    await page.getByRole('link', { name: 'Open probes & heartbeat' }).locator('visible=true').click();
    await expect(page).toHaveURL(/\/probes$/);
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
});
