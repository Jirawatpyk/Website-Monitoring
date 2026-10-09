import { expect, test } from '@playwright/test';
import {
  ensureUser,
  incidentMessages,
  localSupabaseEnabled,
  openTestIncident,
  settleTestIncident,
  signIn,
} from './support/local-supabase';

// S07 (FR-06, T10, D-033): the Incidents list, a note on the timeline and in the thread, the Resolve
// dialog's gate, the 10 s hold and Undo, the phone back arrow and action bar. Local Supabase only
// (E2E_LOCAL_SUPABASE=1, after `pnpm db:reset`); each test opens its own `E2E …` site.
test.describe('incidents, notes and resolve (local Supabase)', () => {
  test.skip(!localSupabaseEnabled, 'needs the local Supabase stack: E2E_LOCAL_SUPABASE=1');
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ context, baseURL }) => {
    await ensureUser('arm@example.test'); // seeded Responder; owns the E2E sites below
    await signIn(context, baseURL!, 'arm@example.test');
  });

  test('the list shows an open incident and opens it', async ({ page }, info) => {
    const id = await openTestIncident('arm@example.test');
    // The site's name, from the incident's own title ("E2E 1a2b3c4d is down").
    await page.goto(`/incidents/${id}`);
    const site = (await page.getByRole('heading', { level: 1 }).textContent())!.replace(/ is down$/, '');
    await page.goto('/incidents');
    await expect(page.getByRole('heading', { level: 1, name: 'Incidents' })).toBeVisible();
    if (info.project.name === 'mobile') {
      await page.getByRole('radio', { name: /^Unacked/ }).click();
      // a long local list stops at a page: open it all
      const all = page.getByRole('button', { name: /^Show all \d+$/ });
      if (await all.isVisible()) await all.click();
    } else {
      await expect(page.getByText(/^\d+ open$/)).toBeVisible();
      // the table shows 50 a page: page on until the incident's row is there
      const row = page.locator(`a[href="/incidents/${id}"]:visible`);
      const next = page.getByRole('button', { name: 'Next page' });
      while (!(await row.count()) && (await next.isVisible()) && (await next.isEnabled())) await next.click();
      await expect(page.getByText(site).filter({ visible: true }).first()).toBeVisible();
    }
    await page.locator(`a[href="/incidents/${id}"]:visible`).first().click();
    await expect(page).toHaveURL(new RegExp(`/incidents/${id}$`));
  });

  test('a note joins the timeline and is posted in the thread at once, no email', async ({ page }) => {
    const id = await openTestIncident('arm@example.test');
    await settleTestIncident(id);
    await page.goto(`/incidents/${id}`);
    await page.getByRole('button', { name: 'Add note' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a note' });
    await expect(dialog.getByRole('button', { name: 'Post note' })).toBeDisabled();
    await dialog.getByLabel('Your note').fill('Host says the app server is restarting');
    await dialog.getByRole('button', { name: 'Post note' }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByText('Host says the app server is restarting').filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(page.getByText('Note by Arm').filter({ visible: true }).first()).toBeVisible();
    expect((await incidentMessages(id, 'note')).map((m) => m.channel)).toEqual(['google_chat']);
  });

  test('T10: Resolve waits for a real root cause; Unknown keeps it open; Undo inside 10 s sends nothing', async ({
    page,
  }) => {
    const id = await openTestIncident('arm@example.test');
    // Still down: Resolve is locked and says why.
    await page.goto(`/incidents/${id}`);
    await expect(
      page
        .getByText(/Resolve locked · 1 of 3 met — .* is still down/)
        .filter({ visible: true })
        .first(),
    ).toBeVisible();

    await settleTestIncident(id);
    await page.reload();
    await page
      .getByRole('button', { name: /^Resolve/ })
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: 'Resolve incident' });
    const resolve = dialog.getByRole('button', { name: 'Resolve incident' });
    await expect(resolve).toBeDisabled();
    await dialog.getByRole('combobox', { name: 'Root cause category' }).click();
    await page.getByRole('option', { name: 'Unknown — keep investigating', exact: true }).click();
    await dialog.getByLabel('What happened').fill('Still looking');
    await expect(dialog.getByRole('button', { name: 'Save, keep open' })).toBeEnabled();
    await expect(dialog.getByText('Unknown keeps the incident open').first()).toBeVisible();

    await dialog.getByRole('combobox', { name: 'Root cause category' }).click();
    await page.getByRole('option', { name: 'Hosting / server', exact: true }).click();
    await dialog.getByLabel('What happened').fill('Host rebooted the app server');
    await expect(resolve).toBeEnabled();
    await resolve.click();
    const done = page.getByRole('dialog', { name: 'Incident resolved' });
    await expect(
      done.getByText(/^Posting to Chat and email in \d+ s|Root cause: Hosting \/ server/).first(),
    ).toBeVisible();
    await done.getByRole('button', { name: /^Undo · \d+ s$/ }).click();
    await expect(done).toBeHidden();
    // Back to Needs root cause; the held RESOLVED never left.
    await expect(page.getByText('Needs root cause').filter({ visible: true }).first()).toBeVisible();
    expect((await incidentMessages(id, 'resolved')).every((m) => m.status === 'cancelled')).toBe(true);
  });

  test('on a phone: the back arrow leads to Incidents and the bar holds Add note and Resolve', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'mobile', 'the phone bar shows below md');
    const id = await openTestIncident('arm@example.test');
    await settleTestIncident(id);
    await page.goto(`/incidents/${id}`);
    for (const name of ['Add note', 'Resolve']) {
      const b = page.getByRole('button', { name, exact: true });
      await expect(b).toBeVisible();
      expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    const back = page.getByRole('link', { name: 'Back to incidents' });
    expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await back.click();
    await expect(page).toHaveURL(/\/incidents$/);
  });
});
