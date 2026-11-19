import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Holiday } from '../holidays';
import { HolidaysSection } from './holidays-section';

const actions = vi.hoisted(() => ({
  addHoliday: vi.fn(),
  renameHoliday: vi.fn(),
  removeHoliday: vi.fn(),
  saveResponseHours: vi.fn(),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('../actions', () => actions);
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/settings/organisation' }));

// The board's clock: Fri 25 Sep 2026 10:08 Bangkok.
const NOW = new Date('2026-09-25T03:08:00Z');
const HOURS = { startMin: 540, endMin: 1080, days: [1, 2, 3, 4, 5] };
const LIST: Holiday[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    day: '2026-12-07',
    name: 'Father’s Day (substitute)',
    kind: 'public',
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    day: '2026-12-30',
    name: 'Company day off — year-end',
    kind: 'company',
  },
];

beforeEach(() => vi.clearAllMocks());

describe('Company holidays', () => {
  it('lists each year with its kind and named row buttons', () => {
    render(<HolidaysSection holidays={LIST} hours={HOURS} now={NOW} />);
    expect(screen.getByText('2026 · 2 left this year · 2 on weekdays')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Holidays 2026' });
    // The badge from md, and the phone's line under the name (company days only).
    expect(within(list).getAllByText('Company day off')).toHaveLength(2);
    expect(within(list).getAllByText('Public holiday')).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Remove Company day off — year-end, Wed 30 Dec' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Makha Bucha, Visakha Bucha and Asanha Bucha 2027/)).toBeInTheDocument();
  });

  it('remove says what the day turns into, then focus moves to the result line', async () => {
    actions.removeHoliday.mockResolvedValue({ ok: true });
    render(<HolidaysSection holidays={LIST} hours={HOURS} now={NOW} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove Company day off — year-end, Wed 30 Dec' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Wed 30 Dec 2026 becomes a working day.')).toBeInTheDocument();
    expect(within(dialog).getByText(/Open incidents use the new calendar too/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove holiday' }));
    expect(actions.removeHoliday).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000002');
    const status = await screen.findByText('Removed Wed 30 Dec · it’s a working day now · logged');
    await waitFor(() => expect(status).toHaveFocus());
    expect(router.refresh).toHaveBeenCalled();
  });

  it('a refused save stays in the dialog with the reason', async () => {
    actions.renameHoliday.mockResolvedValue({ ok: false, message: 'Past days can’t be changed.' });
    render(<HolidaysSection holidays={LIST} hours={HOURS} now={NOW} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Rename Company day off — year-end, Wed 30 Dec' }),
    );
    const dialog = await screen.findByRole('dialog');
    const name = within(dialog).getByRole('textbox', { name: /Name/ });
    await userEvent.clear(name);
    await userEvent.type(name, 'Year-end close');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save name' }));
    expect(await within(dialog).findByText('Past days can’t be changed.')).toBeInTheDocument();
    expect(actions.renameHoliday).toHaveBeenCalledWith({
      id: '00000000-0000-4000-8000-000000000002',
      name: 'Year-end close',
    });
  });

  it('add needs a name, and starts on today as a company day off', async () => {
    render(<HolidaysSection holidays={LIST} hours={HOURS} now={NOW} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add holiday' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add holiday' }));
    expect(await within(dialog).findByText('Give the day a name.')).toBeInTheDocument();
    expect(actions.addHoliday).not.toHaveBeenCalled();
    actions.addHoliday.mockResolvedValue({ ok: true });
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Name/ }), 'Company outing');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add holiday' }));
    expect(actions.addHoliday).toHaveBeenCalledWith({
      day: '2026-09-25',
      name: 'Company outing',
      kind: 'company',
    });
    // The opener is still there, yet focus goes to the result line (not back to Add holiday).
    const status = await screen.findByText(/^Added Fri 25 Sep “Company outing” · logged/);
    await waitFor(() => expect(status).toHaveFocus());
  });

  it('rename succeeds → focus on the result line', async () => {
    actions.renameHoliday.mockResolvedValue({ ok: true });
    render(<HolidaysSection holidays={LIST} hours={HOURS} now={NOW} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Rename Company day off — year-end, Wed 30 Dec' }),
    );
    const dialog = await screen.findByRole('dialog');
    const name = within(dialog).getByRole('textbox', { name: /Name/ });
    await userEvent.clear(name);
    await userEvent.type(name, 'Year-end close');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save name' }));
    const status = await screen.findByText('Renamed Wed 30 Dec to “Year-end close” · logged');
    await waitFor(() => expect(status).toHaveFocus());
  });

  it('Cancel or Escape gives focus back to the button that opened the dialog', async () => {
    render(<HolidaysSection holidays={LIST} hours={HOURS} now={NOW} />);
    const add = screen.getByRole('button', { name: 'Add holiday' });
    await userEvent.click(add);
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(add).toHaveFocus());

    const trash = screen.getByRole('button', { name: 'Remove Father’s Day (substitute), Mon 7 Dec' });
    await userEvent.click(trash);
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(trash).toHaveFocus());
  });

  it('a day outside the hours: removing it changes nothing, said as information', async () => {
    const sat: Holiday = {
      id: '00000000-0000-4000-8000-000000000003',
      day: '2026-12-05',
      name: 'Father’s Day',
      kind: 'public',
    };
    render(<HolidaysSection holidays={[sat]} hours={HOURS} now={NOW} />);
    expect(screen.getByText('Weekend — no effect on Mon–Fri hours')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Father’s Day, Sat 5 Dec' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Nothing changes on Sat 5 Dec')).toBeInTheDocument();
  });
});
