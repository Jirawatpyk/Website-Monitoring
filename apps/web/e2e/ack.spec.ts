import { expect, test } from '@playwright/test';
import {
  ackMessages,
  ensureUser,
  localSupabaseEnabled,
  openTestIncident,
  signIn,
} from './support/local-supabase';

// MobileAck (S02b Done-when 4 and 5): the card link opens the incident signed in, one tap acks, and
// Undo inside 10 s sends nothing. Local Supabase only (E2E_LOCAL_SUPABASE=1, after `pnpm db:reset`).
test.describe('acknowledge from the alert link (local Supabase)', () => {
  test.skip(!localSupabaseEnabled, 'needs the local Supabase stack: E2E_LOCAL_SUPABASE=1');
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ context, baseURL }) => {
    await ensureUser('arm@example.test'); // seeded Responder, primary owner of seeded sites
    await signIn(context, baseURL!, 'arm@example.test');
  });

  test('T08: Ack → Undo within 10 s → nothing is sent, the rows end cancelled', async ({ page }) => {
    const id = await openTestIncident('arm@example.test');
    await page.goto(`/incidents/${id}?ack=1`);
    await expect(page.getByText('Signed in as')).toContainText('arm@example.test');
    const ack = page.getByRole('button', { name: 'Acknowledge' });
    expect((await ack.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await ack.click();

    await expect(page.getByText('Acknowledged as Arm')).toBeVisible();
    await expect(page.getByText(/^Posting to Chat and email in \d+ s/)).toBeVisible();
    const undo = page.getByRole('button', { name: /^Undo · \d+ s$/ });
    // Touch targets ≥ 44 px (spec §14.17).
    for (const control of [undo, page.getByRole('link', { name: 'Visit site (opens in a new tab)' })]) {
      if (await control.count()) expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    await undo.click();

    await expect(page.getByRole('button', { name: 'Acknowledge' })).toBeVisible();
    await expect(page.getByText('Acknowledgement undone by Arm')).toBeVisible();
    expect(await ackMessages(id)).toEqual([
      { channel: 'google_chat', status: 'cancelled' },
      { channel: 'email', status: 'cancelled' },
    ]);
  });

  test('one tap acknowledges under the person’s name; Undo goes once the window closes', async ({ page }) => {
    const id = await openTestIncident('arm@example.test');
    await page.goto(`/incidents/${id}?ack=1`);
    await page.getByRole('button', { name: 'Acknowledge' }).click();
    await expect(page.getByText('Acknowledged as Arm')).toBeVisible();
    await expect(page.getByText('Acknowledged', { exact: true })).toBeVisible(); // workflow badge
    await expect(page.getByRole('button', { name: /^Undo/ })).toBeHidden({ timeout: 15_000 });
    expect((await ackMessages(id)).map((m) => m.status)).not.toContain('cancelled');
  });
});
