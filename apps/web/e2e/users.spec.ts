import { expect, test, type Page } from '@playwright/test';
import { ensureUser, localSupabaseEnabled, setRole, signIn } from './support/local-supabase';

// S16 (D-062): Settings › Users & roles. Local Supabase only (E2E_LOCAL_SUPABASE=1). Everything a test
// changes it puts back (Mint goes back to Viewer, the invited address is removed again).
test.describe('users & roles (local Supabase)', () => {
  test.skip(!localSupabaseEnabled, 'needs the local Supabase stack: E2E_LOCAL_SUPABASE=1');

  async function choose(page: Page, label: string, option: string) {
    await page.getByRole('combobox', { name: label }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  }

  async function rowMenu(page: Page, name: string, item: string) {
    await page.getByRole('button', { name: `Actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: item }).click();
  }

  test('an Admin adds an address, then removes it; both logged', async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name === 'mobile', 'view only on phones (§22.5)');
    const email = `e2e-${crypto.randomUUID().slice(0, 8)}@example.test`;
    await ensureUser('tao@example.test');
    await signIn(context, baseURL!, 'tao@example.test');
    await page.goto('/settings/users');
    await page.getByRole('button', { name: 'Add person' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add someone to Monitor' });
    await expect(dialog.getByText('not a DxT alias')).toBeVisible();
    await dialog.getByLabel('Primary Google address').fill(email);
    await dialog.getByRole('button', { name: 'Add to access list' }).click();
    await expect(page.getByTestId('users-count')).toHaveText(
      `Added ${email} as Responder · they can sign in now · logged`,
    );
    await expect(page.getByText('Not signed in yet · added', { exact: false }).first()).toBeVisible();

    await rowMenu(page, email, 'Remove from access list…');
    const revoke = page.getByRole('dialog', { name: `Remove ${email} from the access list?` });
    await revoke.getByRole('button', { name: 'Remove' }).click();
    await expect(revoke.getByText('Add a short reason — it goes in the audit log')).toBeVisible();
    await revoke.getByLabel('Reason').fill('E2E clean-up');
    await revoke.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByTestId('users-count')).toHaveText(
      `${email} removed from the access list · logged`,
    );
    await expect(page.getByRole('button', { name: `Actions for ${email}` })).toHaveCount(0);
  });

  test('Used in lists the places, and the save waits for every pick (Done-when 2)', async ({
    page,
    context,
    baseURL,
  }, info) => {
    test.skip(info.project.name === 'mobile', 'view only on phones (§22.5)');
    // A run that stopped half way may have left Mint a Stakeholder.
    await setRole('mint@example.test', 'viewer');
    await ensureUser('tao@example.test');
    await signIn(context, baseURL!, 'tao@example.test');
    await page.goto('/settings/users');

    // Nok owns sites in the seed: Responder → Viewer asks for a new owner per site, and won't save without.
    await rowMenu(page, 'Nok', 'Change role…');
    const dialog = page.getByRole('dialog', { name: 'Change Nok’s role' });
    await expect(dialog.getByText(/^Owner of \d+ sites?$/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Change to Viewer' }).click();
    await expect(
      dialog.getByText('Pick a person', { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();

    // Mint (a Viewer, used nowhere) → Stakeholder saves, says it becomes the CEO, then goes back.
    await rowMenu(page, 'Mint', 'Change role…');
    const mint = page.getByRole('dialog', { name: 'Change Mint’s role' });
    await choose(page, 'New role', 'Stakeholder');
    await expect(mint.getByText(/gets the CEO step on Tier 1 DOWN/)).toBeVisible();
    await mint.getByRole('button', { name: 'Change to Stakeholder' }).click();
    await expect(page.getByTestId('users-count')).toHaveText(
      'Mint is now Stakeholder · reassignments applied · logged',
    );
    // The refreshed row before reopening: the dialog starts from the role the page has.
    await expect(
      page.getByRole('row', { name: /Mint/ }).getByText('Stakeholder', { exact: true }),
    ).toBeVisible();

    await rowMenu(page, 'Mint', 'Change role…');
    await choose(page, 'New role', 'Viewer');
    await page
      .getByRole('dialog', { name: 'Change Mint’s role' })
      .getByRole('button', { name: 'Change to Viewer' })
      .click();
    await expect(page.getByTestId('users-count')).toHaveText(
      'Mint is now Viewer · reassignments applied · logged',
    );

    await page.goto('/audit?cat=access&when=today');
    await expect(page.getByText('Changed role').filter({ visible: true }).first()).toBeVisible();
  });

  test('yourself: Change role and Deactivate are off, with the reason', async ({
    page,
    context,
    baseURL,
  }, info) => {
    test.skip(info.project.name === 'mobile', 'view only on phones (§22.5)');
    await ensureUser('tao@example.test');
    await signIn(context, baseURL!, 'tao@example.test');
    await page.goto('/settings/users');
    await page.getByRole('button', { name: 'Actions for Tao' }).click();
    await expect(page.getByRole('menuitem', { name: /Change role/ })).toBeDisabled();
    await expect(
      page.getByText('You can’t change your own access — ask another Admin.').first(),
    ).toBeAttached();
  });

  test('a Responder gets No access', async ({ page, context, baseURL }) => {
    await ensureUser('arm@example.test');
    await signIn(context, baseURL!, 'arm@example.test');
    await page.goto('/settings/users');
    await expect(page.getByText('Only Admins can see Settings')).toBeVisible();
    await expect(page.getByText('You’re signed in as Arm (Responder).', { exact: false })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to Overview', exact: true })).toBeVisible();
  });

  test('phone: view only — cards, a sheet, one role at a time (§35)', async ({
    page,
    context,
    baseURL,
  }, info) => {
    test.skip(info.project.name !== 'mobile', 'the phone layout');
    await ensureUser('tao@example.test');
    await signIn(context, baseURL!, 'tao@example.test');
    await page.goto('/settings/users');
    await expect(page.getByText('View only on phones.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add person' })).toBeHidden();
    await page.getByRole('button', { name: /^Nok, Responder, .*Show details$/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Nok' });
    await expect(sheet.getByText('Roles and reassignments change on a larger screen.')).toBeVisible();
    await sheet.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(page.getByText('Responder: 6 of 10 allowed.', { exact: false })).toBeVisible();
    await page.locator('select.aura-select__native').last().selectOption({ label: 'Stakeholder' });
    await expect(page.getByText('Stakeholder: 5 of 10 allowed.', { exact: false })).toBeVisible();
  });
});
