import { describe, expect, it, vi } from 'vitest';
import { addHoliday, removeHoliday, renameHoliday, saveHours, type OrganisationDeps } from './mutations';

function db(error: { code?: string; hint?: string; message: string; details?: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error });
  return { deps: { db: { rpc } } as unknown as OrganisationDeps, rpc };
}

describe('saveHours (S17, D-069)', () => {
  it('sends the board’s choices as SQL’s days and times, with the trimmed note', async () => {
    const { deps, rpc } = db();
    expect(
      await saveHours({ days: 'Mon–Sat', from: '08:30', to: '17:30', note: ' Office opens earlier ' }, deps),
    ).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('save_response_hours', {
      p_start: '08:30',
      p_end: '17:30',
      p_days: [1, 2, 3, 4, 5, 6],
      p_note: 'Office opens earlier',
    });
  });

  it('refuses without a note, backwards hours or an off-grid time before the database', async () => {
    const { deps, rpc } = db();
    expect(await saveHours({ days: 'Mon–Fri', from: '09:00', to: '18:00', note: ' ' }, deps)).toEqual({
      ok: false,
      message: 'Add a short note — it goes in the audit log with the change',
    });
    expect(await saveHours({ days: 'Mon–Fri', from: '18:00', to: '09:00', note: 'n' }, deps)).toEqual({
      ok: false,
      message: '“To” must be after “From”',
    });
    expect((await saveHours({ days: 'Mon–Fri', from: '09:15', to: '18:00', note: 'n' }, deps)).ok).toBe(
      false,
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it('words what the SQL refused', async () => {
    expect(
      await saveHours(
        { days: 'Mon–Fri', from: '09:00', to: '18:00', note: 'n' },
        db({ code: '42501', message: 'Only an Admin can change the response hours' }).deps,
      ),
    ).toEqual({ ok: false, message: 'Only an Admin can change the response hours.' });
    expect(
      await saveHours(
        { days: 'Mon–Fri', from: '09:00', to: '18:00', note: 'n' },
        db({ code: '22023', hint: 'hours_order', message: '“To” must be after “From”' }).deps,
      ),
    ).toEqual({ ok: false, message: '“To” must be after “From”' });
    expect(
      await saveHours(
        { days: 'Mon–Fri', from: '09:00', to: '18:00', note: 'n' },
        db({ message: 'timeout' }).deps,
      ),
    ).toEqual({ ok: false, message: 'Couldn’t save. Check your connection and try again.' });
  });
});

describe('company holidays (S17 PR 3a)', () => {
  const ID = '00000000-0000-4000-8000-000000000002';
  it('add sends the day, the trimmed name and the kind', async () => {
    const { deps, rpc } = db();
    expect(await addHoliday({ day: '2026-12-30', name: ' Year-end ', kind: 'company' }, deps)).toEqual({
      ok: true,
    });
    expect(rpc).toHaveBeenCalledWith('add_company_holiday', {
      p_day: '2026-12-30',
      p_name: 'Year-end',
      p_kind: 'company',
    });
  });

  it('a taken day names the holiday it already is', async () => {
    const taken = db({
      code: '23505',
      hint: 'holiday_taken',
      message: 'That day is already a holiday',
      details: 'Father’s Day (substitute)',
    });
    expect(await addHoliday({ day: '2026-12-07', name: 'Outing', kind: 'company' }, taken.deps)).toEqual({
      ok: false,
      message: 'Mon 7 Dec is already Father’s Day (substitute).',
    });
  });

  it('SQL refusals in words; a Responder; the minutes before the migration; anything else', async () => {
    const past = db({ code: '22023', hint: 'holiday_past', message: 'Past days can’t be changed' });
    expect(await renameHoliday({ id: ID, name: 'x' }, past.deps)).toEqual({
      ok: false,
      message: 'Past days can’t be changed.',
    });
    const responder = db({ code: '42501', message: 'nope' });
    expect(await removeHoliday(ID, responder.deps)).toEqual({
      ok: false,
      message: 'Only an Admin can change the company holidays.',
    });
    const lag = db({ code: 'PGRST202', message: 'Could not find the function' });
    expect(await removeHoliday(ID, lag.deps)).toEqual({
      ok: false,
      message: 'Holidays can’t be changed for a minute — try again shortly.',
    });
    const other = db({ code: '57014', message: 'timeout' });
    expect(await removeHoliday(ID, other.deps)).toEqual({
      ok: false,
      message: 'Couldn’t save. Check your connection and try again.',
    });
  });

  it('refuses a bad id or an empty name before the database', async () => {
    const { deps, rpc } = db();
    expect(await removeHoliday('not-an-id', deps)).toEqual({
      ok: false,
      message: 'That holiday is gone — reload the page.',
    });
    expect(await renameHoliday({ id: ID, name: '  ' }, deps)).toEqual({
      ok: false,
      message: 'Give the day a name.',
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
