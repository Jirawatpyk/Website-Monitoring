import { describe, expect, it, vi } from 'vitest';
import { saveHours, type OrganisationDeps } from './mutations';

function db(error: { code?: string; hint?: string; message: string } | null = null) {
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
