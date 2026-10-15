import { expect, test, type Page } from '@playwright/test';
import {
  baselineAudit,
  ensureUser,
  localSupabaseEnabled,
  openPageChangeIncident,
  signIn,
} from './support/local-supabase';

// S09d (spec §26, D-046): the What changed card, Accept as new baseline with its Undo, the Page
// fingerprint card on Site detail, and Resolve with "Also accept the current page". Local Supabase only
// (E2E_LOCAL_SUPABASE=1, after `pnpm db:reset`); each test opens its own `E2E …` site.
/** The visible copy of the page (phone and desktop draw the card in different places). */
const visible = (page: Page) => ({
  getByText: (text: string | RegExp) => page.getByText(text).filter({ visible: true }).first(),
  getByRole: (role: 'button', o: { name: string | RegExp }) =>
    page.getByRole(role, o).filter({ visible: true }),
});

test.describe('page change (local Supabase)', () => {
  test.skip(!localSupabaseEnabled, 'needs the local Supabase stack: E2E_LOCAL_SUPABASE=1');
  test.describe.configure({ mode: 'serial' });

  test('a Responder sees What changed read-only, with the Admin hint', async ({ page, context, baseURL }) => {
    await ensureUser('arm@example.test');
    await signIn(context, baseURL!, 'arm@example.test');
    const { incidentId } = await openPageChangeIncident('arm@example.test');
    await page.goto(`/incidents/${incidentId}`);
    const card = visible(page);
    await expect(card.getByText('+ evil-cdn.example')).toBeVisible();
    await expect(card.getByText('Only an Admin can accept a new baseline')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Accept as new baseline' })).toHaveCount(0);
  });

  test.describe('as an Admin', () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await ensureUser('tao@example.test');
      await signIn(context, baseURL!, 'tao@example.test');
    });

    test('What changed shows Was / Now and the new script domain; the header names the change', async ({
      page,
    }, info) => {
      const { incidentId } = await openPageChangeIncident('arm@example.test');
      await page.goto(`/incidents/${incidentId}`);
      await expect(page.getByText('2 changes on / · new script domain evil-cdn.example')).toBeVisible();
      const card = visible(page);
      await expect(card.getByText(/Lucky Deals$/)).toBeVisible();
      await expect(card.getByText('+ evil-cdn.example')).toBeVisible();
      await expect(card.getByRole('button', { name: 'and 2 unchanged' }).first()).toBeVisible();
      await expect(page.getByText('Trigger: Page change').first()).toBeVisible();
      await page.screenshot({ path: info.outputPath('what-changed.png'), fullPage: true });
    });

    test('Accept as new baseline: the danger warning, Undo inside 10 s, then for real — audited', async ({
      page,
    }) => {
      const { incidentId, monitorId } = await openPageChangeIncident('arm@example.test');
      await page.goto(`/incidents/${incidentId}`);
      const card = visible(page);
      await card.getByRole('button', { name: 'Accept as new baseline' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Accept the current page as the new baseline?' });
      await expect(dialog.getByText('A new script domain usually means injected code.')).toBeVisible();
      const confirm = dialog.getByRole('button', { name: 'Accept as baseline' });
      await expect(confirm).toBeDisabled();
      await dialog.getByLabel('Reason').fill('Client added the partner script (ticket 4821)');
      await confirm.click();
      // the action re-renders the page (revalidatePath): slow under next dev
      await expect(page.getByText('Accepting as the new baseline').first()).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: /^Undo · \d+ s$/ }).click();
      await expect(page.getByText('Undone — the baseline is unchanged')).toBeVisible();
      expect(await baselineAudit(monitorId)).toEqual([
        'page_baseline.auto',
        'page_baseline.accept',
        'page_baseline.undo',
      ]);

      await page.reload();
      await card.getByRole('button', { name: 'Accept as new baseline' }).first().click();
      await dialog.getByLabel('Reason').fill('Client added the partner script (ticket 4821)');
      await dialog.getByRole('button', { name: 'Accept as baseline' }).click();
      // the action re-renders the page (revalidatePath): slow under next dev
      await expect(page.getByText('Accepting as the new baseline').first()).toBeVisible({ timeout: 20_000 });
      await expect
        .poll(() => baselineAudit(monitorId))
        .toEqual([
          'page_baseline.auto',
          'page_baseline.accept',
          'page_baseline.undo',
          'page_baseline.accept',
        ]);
      // The card says it while the Undo is open, and the timeline keeps both accepts (§16.11).
      await expect(card.getByText(/^Accepting as the new baseline — Undo is open until/)).toBeVisible();
      await expect(
        page
          .getByText(/Baseline accepted by Tao · “Client added the partner script/)
          .filter({ visible: true }),
      ).toHaveCount(2);
    });

    test('Site detail shows the Page fingerprint card with the PROBLEM open', async ({ page }, info) => {
      const { siteId } = await openPageChangeIncident('arm@example.test');
      await page.goto(`/sites/${siteId}`);
      const card = visible(page);
      await expect(
        card.getByText(/^Differs from the baseline · PROBLEM open since \d\d:\d\d$/),
      ).toBeVisible();
      await expect(card.getByText('+ evil-cdn.example')).toBeVisible();
      await expect(card.getByRole('button', { name: 'Accept as new baseline' }).first()).toBeVisible();
      await page.screenshot({ path: info.outputPath('page-fingerprint.png'), fullPage: true });
    });

    test('Resolve as Client-side change accepts the page and resolves at once', async ({ page }) => {
      const { incidentId, monitorId } = await openPageChangeIncident('arm@example.test');
      await page.goto(`/incidents/${incidentId}`);
      await page
        .getByRole('button', { name: 'Root cause & resolve…' })
        .filter({ visible: true })
        .first()
        .click();
      const dialog = page.getByRole('dialog', { name: 'Resolve incident' });
      await dialog.getByRole('combobox', { name: 'Root cause category' }).click();
      await page.getByRole('option', { name: 'Client-side change', exact: true }).click();
      const box = dialog.getByRole('checkbox', { name: 'Also accept the current page as the new baseline' });
      await expect(box).toBeChecked();
      await dialog.getByLabel('What happened').fill('Client launched a partner script (ticket 4821)');
      await dialog.getByRole('button', { name: 'Accept baseline and resolve' }).click();
      await expect(page.getByRole('dialog', { name: 'Incident resolved' })).toBeVisible();
      expect(await baselineAudit(monitorId)).toEqual(['page_baseline.auto', 'page_baseline.accept']);
    });
  });
});
