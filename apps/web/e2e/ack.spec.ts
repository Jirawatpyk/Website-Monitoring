import { expect, test } from '@playwright/test';
import {
  ackMessages,
  ensureUser,
  localSupabaseEnabled,
  openTestIncident,
  signIn,
} from './support/local-supabase';

// MobileAck (S02b Done-when 4 and 5): the card link opens the incident signed in, one tap acks, and
// Undo inside 10 s sends nothing — on a phone; from md the Incident page acks from its header with the
// toast (S07). Local Supabase only (E2E_LOCAL_SUPABASE=1, after `pnpm db:reset`).
test.describe('acknowledge from the alert link (local Supabase)', () => {
  test.skip(!localSupabaseEnabled, 'needs the local Supabase stack: E2E_LOCAL_SUPABASE=1');
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ context, baseURL }) => {
    await ensureUser('arm@example.test'); // seeded Responder, primary owner of seeded sites
    await signIn(context, baseURL!, 'arm@example.test');
  });

  test('on a phone the incident page keeps the BottomNav away, so its action bar has the bottom edge (S06b)', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'mobile', 'BottomNav shows below lg');
    const id = await openTestIncident('arm@example.test');
    await page.goto(`/incidents/${id}`);
    await expect(page.getByRole('button', { name: 'Acknowledge' })).toBeVisible();
    // gone from the first paint (CSS on the bar's marker), not after the client runs
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeHidden();
  });

  test('on a phone the BottomNav slides away scrolling down and comes back scrolling up (S06b)', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'mobile', 'BottomNav shows below lg');
    await page.goto('/sites');
    // Hydrated (AURA's scroll listener attached) before the first wheel — a wheel before it was lost
    // and failed CI's first attempt (#77). The list's length depends on what other specs created, so
    // the page gets room to scroll; the behaviour under test is the bar, not the list.
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('main')!.style.paddingBottom = '200vh';
    });
    const nav = page.locator('.aura-bottomnav');
    const height = page.viewportSize()!.height;
    const top = async () => (await nav.boundingBox())!.y;
    await expect.poll(top).toBeLessThan(height - 1);
    await expect(async () => {
      await page.mouse.wheel(0, 600);
      expect(await top()).toBeGreaterThanOrEqual(height - 1);
    }).toPass({ timeout: 10_000 });
    await expect(async () => {
      await page.mouse.wheel(0, -300);
      expect(await top()).toBeLessThan(height - 1);
    }).toPass({ timeout: 10_000 });
  });

  test('T08: Ack → Undo within 10 s → nothing is sent, the rows end cancelled', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'MobileAck parts show below md; desktop acks from the header');
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
    // desktop and phone timelines are both in the page; the phone's is the one showing
    await expect(page.getByText('Acknowledgement undone by Arm').filter({ visible: true })).toBeVisible();
    expect(await ackMessages(id)).toEqual([
      { channel: 'google_chat', status: 'cancelled' },
      { channel: 'email', status: 'cancelled' },
    ]);
  });

  test('the action bar sits on the bottom edge of the screen, even with little content', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'mobile', 'MobileAck parts show below md; desktop acks from the header');
    const id = await openTestIncident('arm@example.test');
    await page.goto(`/incidents/${id}`);
    const bar = page
      .getByRole('button', { name: 'Acknowledge' })
      .locator('xpath=ancestor::div[contains(@class,"sticky")][1]');
    const box = await bar.boundingBox();
    const height = page.viewportSize()!.height;
    expect(Math.abs(box!.y + box!.height - height)).toBeLessThanOrEqual(1);
  });

  test('one tap acknowledges under the person’s name; Undo goes once the window closes', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'mobile', 'MobileAck parts show below md; desktop acks from the header');
    const id = await openTestIncident('arm@example.test');
    await page.goto(`/incidents/${id}?ack=1`);
    await page.getByRole('button', { name: 'Acknowledge' }).click();
    await expect(page.getByText('Acknowledged as Arm')).toBeVisible();
    await expect(page.getByText('Acknowledged', { exact: true })).toBeVisible(); // workflow badge
    await expect(page.getByRole('button', { name: /^Undo/ })).toBeHidden({ timeout: 15_000 });
    expect((await ackMessages(id)).map((m) => m.status)).not.toContain('cancelled');
  });

  test('T08 on desktop: Acknowledge in the header, the toast counts down, Undo sends nothing (S07)', async ({
    page,
  }, info) => {
    test.skip(info.project.name === 'mobile', 'desktop header');
    const id = await openTestIncident('arm@example.test');
    await page.goto(`/incidents/${id}`);
    await page.getByRole('button', { name: 'Acknowledge' }).click();
    await expect(page.getByText(/^Acknowledged INC-\d+/)).toBeVisible();
    await page.getByRole('button', { name: /^Undo · \d+ s$/ }).click();
    await expect(page.getByText(/^Acknowledgement of INC-\d+ undone/)).toBeVisible();
    expect(await ackMessages(id)).toEqual([
      { channel: 'google_chat', status: 'cancelled' },
      { channel: 'email', status: 'cancelled' },
    ]);
  });
});
