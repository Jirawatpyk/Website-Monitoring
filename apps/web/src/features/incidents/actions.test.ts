// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  after: vi.fn(),
  revalidatePath: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: m.rpc }) }));
vi.mock('next/server', () => ({ after: m.after }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidatePath }));
vi.mock('@/server/db', () => ({ serviceDb: () => 'db' }));
vi.mock('@/server/notifier/dispatch', () => ({ dispatchNotifications: m.dispatch }));
vi.mock('@/lib/env', () => ({ serverEnv: () => ({}) }));

const { acknowledgeIncident, undoAcknowledge } = await import('./actions');
const ID = '7c481a3b-6979-4c48-97eb-50a8d27c4e41';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('acknowledgeIncident', () => {
  it('acks through the SQL function, then sends the held messages once the window closes', async () => {
    vi.setSystemTime(new Date('2026-10-06T14:00:00Z'));
    m.rpc.mockResolvedValue({ data: '2026-10-06T14:00:10Z', error: null });
    m.dispatch.mockResolvedValue({ ok: true });
    expect(await acknowledgeIncident(ID)).toEqual({ ok: true, postsAt: '2026-10-06T14:00:10Z' });
    expect(m.rpc).toHaveBeenCalledWith('ack_incident', { p_incident_id: ID });
    expect(m.revalidatePath).toHaveBeenCalledWith(`/incidents/${ID}`);

    const flush = (m.after.mock.calls[0] as [() => Promise<void>])[0]();
    await vi.advanceTimersByTimeAsync(11_500);
    expect(m.dispatch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    await flush;
    expect(m.dispatch).toHaveBeenCalledWith(expect.objectContaining({ db: 'db' }), {
      incidentId: ID,
      deadline: expect.any(Number),
    });
  });

  it('logs a failed flush instead of throwing (the cron sweep sends it)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    m.rpc.mockResolvedValue({ data: new Date(Date.now() - 1000).toISOString(), error: null });
    m.dispatch.mockRejectedValue(new Error('down'));
    await acknowledgeIncident(ID);
    const flush = (m.after.mock.calls[0] as [() => Promise<void>])[0]();
    await vi.advanceTimersByTimeAsync(2_000);
    await flush;
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('ack_flush_failed'));
  });

  it.each([
    ['42501', 'Only the site’s owner, its backup or an Admin can acknowledge this incident.'],
    ['55000', 'This incident is no longer waiting for an acknowledgement.'],
    ['P0002', 'This incident doesn’t exist any more.'],
    ['XX000', 'Couldn’t reach the server. Check your connection and try again.'],
  ])('turns database code %s into words', async (code, message) => {
    m.rpc.mockResolvedValue({ data: null, error: { code, message: 'raw' } });
    expect(await acknowledgeIncident(ID)).toEqual({ ok: false, message });
    expect(m.after).not.toHaveBeenCalled();
  });

  it('refuses a malformed id without calling the database', async () => {
    expect(await acknowledgeIncident('x')).toMatchObject({ ok: false });
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe('undoAcknowledge', () => {
  it('undoes through the SQL function', async () => {
    m.rpc.mockResolvedValue({ data: null, error: null });
    expect(await undoAcknowledge(ID)).toEqual({ ok: true });
    expect(m.rpc).toHaveBeenCalledWith('undo_ack', { p_incident_id: ID });
    expect(m.revalidatePath).toHaveBeenCalledWith(`/incidents/${ID}`);
  });

  it.each([
    ['55000', 'Too late to undo — the acknowledgement has been posted.'],
    ['42501', 'Only the person who acknowledged can undo it.'],
  ])('turns database code %s into words', async (code, message) => {
    m.rpc.mockResolvedValue({ data: null, error: { code, message: 'raw' } });
    expect(await undoAcknowledge(ID)).toEqual({ ok: false, message });
  });

  it('refuses a malformed id', async () => {
    expect(await undoAcknowledge('x')).toMatchObject({ ok: false });
  });
});
