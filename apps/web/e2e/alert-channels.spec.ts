import { expect, test } from '@playwright/test';
import { ensureUser, localSupabaseEnabled, signIn } from './support/local-supabase';

// S17 PR 2 (D-069): Settings › Alert channels. Local Supabase only; the dev server has no Chat webhook
// or Resend key, so the test buttons say why they can't send (the real send is channel-test.int.test.ts).
test.describe('alert channels (local Supabase)', () => {
  test.skip(!localSupabaseEnabled, 'needs the local Supabase stack: E2E_LOCAL_SUPABASE=1');

  test('the channels, who gets what (read-only) and the delivery log', async ({
    page,
    context,
    baseURL,
  }, info) => {
    await ensureUser('tao@example.test');
    await signIn(context, baseURL!, 'tao@example.test');
    await page.goto('/settings/alert-channels');
    await expect(page.getByRole('heading', { name: 'Google Chat', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Email · Resend' })).toBeVisible();
    // No dead controls (§14.16): without a webhook the button is disabled with its reason.
    await expect(page.getByRole('button', { name: 'Send test card' })).toBeDisabled();
    await expect(page.getByText('Can’t test — the Chat webhook isn’t set up.')).toBeVisible();
    if (info.project.name === 'mobile') {
      await expect(page.getByText('View only on phones.')).toBeVisible();
      await expect(page.getByText('WHO GETS WHAT', { exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole('link', { name: 'Set per step in Escalation' })).toHaveCount(3);
      await expect(page.getByText('Read-only · fixed')).toHaveCount(2);
      await expect(page.getByRole('heading', { name: 'Delivery log' })).toBeVisible();
    }
  });
});
