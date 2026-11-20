import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Phrase } from '../phrases';
import { ForbiddenSection } from './forbidden-section';

const actions = vi.hoisted(() => ({
  checkPhrase: vi.fn(),
  addPhrase: vi.fn(),
  removePhrase: vi.fn(),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('../actions', () => actions);
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/settings/organisation' }));

const LIST: Phrase[] = [
  { id: '00000000-0000-4000-8000-000000000001', group: 'gambling_th', phrase: 'บาคาร่า' },
  { id: '00000000-0000-4000-8000-000000000002', group: 'gambling_th', phrase: 'แทงบอล' },
  { id: '00000000-0000-4000-8000-000000000003', group: 'gambling_en', phrase: 'slot online' },
  { id: '00000000-0000-4000-8000-000000000004', group: 'gambling_en', phrase: 'online casino' },
  { id: '00000000-0000-4000-8000-000000000005', group: 'pharma', phrase: 'buy viagra' },
];
const CLEAR = { sites: 17, checked: 17, unchecked: [], found: 0, hits: [] };

beforeEach(() => vi.clearAllMocks());

async function openAdd() {
  render(<ForbiddenSection phrases={LIST} liveSites={17} />);
  await userEvent.click(screen.getByRole('button', { name: 'Add phrase' }));
  return screen.findByRole('dialog', { name: 'Add a forbidden phrase' });
}

describe('Shared forbidden words', () => {
  it('groups are collapsed with a count; Show opens one, its chips carry their language', async () => {
    render(<ForbiddenSection phrases={LIST} liveSites={17} />);
    expect(screen.getByText(/A hit opens PROBLEM · Keyword on that site\. 5 phrases\./)).toBeInTheDocument();
    expect(screen.queryByText('บาคาร่า')).not.toBeInTheDocument();
    const show = screen.getByRole('button', { name: 'Show 2 phrases in Gambling · Thai' });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(show);
    const list = screen.getByRole('list', { name: 'Gambling · Thai phrases' });
    // The phrase alone carries lang="th"; the × button's English name doesn't.
    expect(within(list).getAllByText('บาคาร่า')[0]).toHaveAttribute('lang', 'th');
    expect(within(list).getAllByText('บาคาร่า')[0]!.closest('li')).not.toHaveAttribute('lang');
    expect(screen.getByRole('button', { name: 'Hide 2 phrases in Gambling · Thai' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('a single short word and a phrase already listed are refused before any check', async () => {
    const dialog = await openAdd();
    const field = within(dialog).getByRole('textbox', { name: /Phrase/ });
    await userEvent.type(field, 'slot');
    expect(within(dialog).getByText(/a single short word is refused/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Check phrase' })).toBeDisabled();
    await userEvent.clear(field);
    await userEvent.type(field, 'SLOT  online');
    expect(within(dialog).getByText('Already in the list.')).toBeInTheDocument();
    expect(actions.checkPhrase).not.toHaveBeenCalled();
  });

  it('found on a site: the box names it, shows the match, and the button stays off until the phrase changes', async () => {
    actions.checkPhrase.mockResolvedValue({
      ok: true,
      check: {
        ...CLEAR,
        hits: [
          { site: 'MuvMi', view: 'plain', checkedAt: '2026-09-25T02:30:00Z', snippet: 'รับเครดิตฟรี 50 บาท' },
        ],
      },
    });
    const dialog = await openAdd();
    const field = within(dialog).getByRole('textbox', { name: /Phrase/ });
    await userEvent.type(field, 'เครดิตฟรี');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Check phrase' }));
    expect(
      await within(dialog).findByText(
        'Found on MuvMi’s home page — this would open a PROBLEM on a healthy site',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('เครดิตฟรี', { selector: 'mark' })).toBeInTheDocument();
    expect(within(dialog).getByText('Not saved — change the phrase and check again.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Check phrase' })).toBeDisabled();
    // A new phrase asks for a new check.
    await userEvent.type(field, ' กดรับเอง');
    expect(within(dialog).getByRole('button', { name: 'Check phrase' })).toBeEnabled();
    expect(within(dialog).queryByText(/Found on MuvMi/)).not.toBeInTheDocument();
  });

  it('clear: Add and log needs a note, then the result line takes focus', async () => {
    actions.checkPhrase.mockResolvedValue({ ok: true, check: CLEAR });
    actions.addPhrase.mockResolvedValue({ ok: true });
    const dialog = await openAdd();
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Phrase/ }), 'สล็อตเว็บตรง แตกง่าย');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Check phrase' }));
    expect(
      await within(dialog).findByText('Not found on any of the 17 sites’ last clean fetch'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Checked · ready to add')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add and log' }));
    expect(
      within(dialog).getByText('Add a short note — it goes in the audit log with the change.'),
    ).toBeInTheDocument();
    expect(actions.addPhrase).not.toHaveBeenCalled();
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /Change note/ }),
      'Seen on a client site',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add and log' }));
    expect(actions.addPhrase).toHaveBeenCalledWith({
      group: 'gambling_th',
      phrase: 'สล็อตเว็บตรง แตกง่าย',
      note: 'Seen on a client site',
    });
    const status = await screen.findByText(
      'Added “สล็อตเว็บตรง แตกง่าย” to Gambling · Thai · logged · sites are checked for it from the next round',
    );
    await waitFor(() => expect(status).toHaveFocus());
    expect(router.refresh).toHaveBeenCalled();
  });

  it('a refusal at save (the SQL re-checks) shows in the dialog', async () => {
    actions.checkPhrase.mockResolvedValue({ ok: true, check: CLEAR });
    actions.addPhrase.mockResolvedValue({
      ok: false,
      message: 'Found on MuvMi’s home page — change the phrase and check again.',
    });
    const dialog = await openAdd();
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Phrase/ }), 'slot vip room');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Check phrase' }));
    await within(dialog).findByText('Checked · ready to add');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Change note/ }), 'n');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add and log' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/change the phrase and check again/);
  });

  it('remove needs a note; the result line takes focus', async () => {
    actions.removePhrase.mockResolvedValue({ ok: true });
    render(<ForbiddenSection phrases={LIST} liveSites={17} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show 2 phrases in Gambling · English' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove slot online from Gambling · English' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove “slot online”?' });
    expect(
      within(dialog).getByText(/sites stop being checked for it from the next round/),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove and log' }));
    expect(actions.removePhrase).not.toHaveBeenCalled();
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /Change note/ }),
      'Matches a client’s menu',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove and log' }));
    expect(actions.removePhrase).toHaveBeenCalledWith({
      id: '00000000-0000-4000-8000-000000000003',
      note: 'Matches a client’s menu',
    });
    const status = await screen.findByText(/^Removed “slot online” from Gambling · English · logged/);
    await waitFor(() => expect(status).toHaveFocus());
  });

  it('a group’s last phrase has no ×: a group keeps one', async () => {
    render(<ForbiddenSection phrases={LIST} liveSites={17} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show 1 phrase in Pharma' }));
    expect(screen.getAllByText('buy viagra').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^Remove buy viagra/ })).not.toBeInTheDocument();
  });

  it('a found result takes focus (the pressed button is now off) and is announced', async () => {
    actions.checkPhrase.mockResolvedValue({
      ok: true,
      check: {
        ...CLEAR,
        found: 1,
        hits: [{ site: 'MuvMi', view: 'plain', checkedAt: '2026-09-25T02:30:00Z', snippet: 'x' }],
      },
    });
    const dialog = await openAdd();
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Phrase/ }), 'slot vip room');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Check phrase' }));
    const box = await within(dialog).findByText(/^Found on MuvMi/);
    const region = box.closest('[aria-live]');
    expect(region).toHaveAttribute('aria-live', 'polite');
    await waitFor(() => expect(region).toHaveFocus());
  });

  it('a refusal at save goes back to Check phrase, so the dialog never says both', async () => {
    actions.checkPhrase.mockResolvedValue({ ok: true, check: CLEAR });
    actions.addPhrase.mockResolvedValue({ ok: false, message: 'Already in the list.' });
    const dialog = await openAdd();
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Phrase/ }), 'slot vip room');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Check phrase' }));
    await within(dialog).findByText('Checked · ready to add');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Change note/ }), 'n');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add and log' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Already in the list.');
    expect(within(dialog).getByRole('button', { name: 'Check phrase' })).toBeInTheDocument();
    expect(within(dialog).queryByText(/^Not found on/)).not.toBeInTheDocument();
  });

  it('Cancel returns focus to the button that opened the dialog', async () => {
    const dialog = await openAdd();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add phrase' })).toHaveFocus());
  });

  it('a list that couldn’t be read says so, with no Add', () => {
    render(<ForbiddenSection phrases={null} liveSites={17} />);
    expect(screen.getByText('Couldn’t load the list')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add phrase' })).not.toBeInTheDocument();
  });
});
