// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  after: vi.fn(),
  revalidatePath: vi.fn(),
  dispatch: vi.fn(),
  hours: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: m.rpc }) }));
vi.mock('next/server', () => ({ after: m.after }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidatePath }));
vi.mock('@/server/db', () => ({ serviceDb: () => 'db' }));
vi.mock('@/server/notifier/dispatch', () => ({ dispatchNotifications: m.dispatch }));
vi.mock('@/server/escalation/response-hours', () => ({ loadResponseHours: m.hours }));
vi.mock('@/lib/env', () => ({ serverEnv: () => ({}) }));

const { escalateNow, openManualIncident, recordHandCheck, reportDownByHand, sendClientUpdateReminder } =
  await import('./hand-actions');
const SITE = '7c481a3b-6979-4c48-97eb-50a8d27c4e41';
const INC = '0b6f7c1e-2a7d-4c43-9a4f-9c1d1f7f5a10';
// Mon–Fri 09:00–18:00 (spec §7).
const HOURS = { startMin: 540, endMin: 1080, days: [1, 2, 3, 4, 5], holidays: new Set<string>() };

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('the hand check (S12b, spec §30.2)', () => {
  it('Loads OK records through the SQL function and sends nothing', async () => {
    m.rpc.mockResolvedValue({ data: 'hc1', error: null });
    expect(await recordHandCheck(SITE)).toEqual({ ok: true });
    expect(m.rpc).toHaveBeenCalledWith('record_hand_check', { p_site_id: SITE });
    expect(m.after).not.toHaveBeenCalled();
  });

  it('a refusal is said in words, by the hint the SQL raised', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: '55000', hint: 'engine_running', message: 'x' } });
    expect(await recordHandCheck(SITE)).toEqual({
      ok: false,
      message: 'The status engine is running again — it judges the sites and escalates on its own.',
    });
  });

  it('a bad id never reaches the database', async () => {
    expect((await recordHandCheck('nope')).ok).toBe(false);
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe('Down — open incident (§30.2, D-053 item 5)', () => {
  it('Sat 02:31 is outside response hours: L0 pages the person on call; the DOWN leaves from this request', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-26T02:31:00+07:00') });
    m.hours.mockResolvedValue(HOURS);
    m.rpc.mockResolvedValue({ data: INC, error: null });
    expect(await openManualIncident({ siteId: SITE, note: '  Home page shows a 502 error ' })).toEqual({
      ok: true,
      incidentId: INC,
    });
    expect(m.rpc).toHaveBeenCalledWith('open_manual_incident', {
      p_site_id: SITE,
      p_note: 'Home page shows a 502 error',
      p_outside_hours: true,
    });
    expect(m.after).toHaveBeenCalledTimes(1);
  });

  it('Mon 10:00 is inside: L0 is the owner', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-28T10:00:00+07:00') });
    m.hours.mockResolvedValue(HOURS);
    m.rpc.mockResolvedValue({ data: INC, error: null });
    await openManualIncident({ siteId: SITE });
    expect(m.rpc.mock.calls[0]![1]).toMatchObject({ p_outside_hours: false, p_note: '' });
  });

  it('a note over 500 characters never reaches the database', async () => {
    m.hours.mockResolvedValue(HOURS);
    expect(await openManualIncident({ siteId: SITE, note: 'x'.repeat(501) })).toEqual({
      ok: false,
      message: 'Keep it under 500 characters',
    });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('a site with an open incident is refused in words', async () => {
    m.hours.mockResolvedValue(HOURS);
    m.rpc.mockResolvedValue({ data: null, error: { code: '55000', hint: 'already_open', message: 'x' } });
    expect(await openManualIncident({ siteId: SITE })).toEqual({
      ok: false,
      message: 'This site already has an open incident.',
    });
    expect(m.after).not.toHaveBeenCalled();
  });
});

describe('Down again by hand (D-055 item 7)', () => {
  it('reports the open incident down, with the hours verdict, and sends at once', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-26T02:31:00+07:00') });
    m.hours.mockResolvedValue(HOURS);
    m.rpc.mockResolvedValue({ data: 'relapse', error: null });
    expect(await reportDownByHand({ incidentId: INC, note: ' 502 again ' })).toEqual({
      ok: true,
      incidentId: INC,
    });
    expect(m.rpc).toHaveBeenCalledWith('report_down_by_hand', {
      p_incident_id: INC,
      p_note: '502 again',
      p_outside_hours: true,
    });
    expect(m.after).toHaveBeenCalledTimes(1);
  });

  it('a DOWN still open is refused in words', async () => {
    m.hours.mockResolvedValue(HOURS);
    m.rpc.mockResolvedValue({ data: null, error: { code: '55000', hint: 'not_down_again', message: 'x' } });
    // stale: the dialog keeps Report down disabled (§31.6)
    expect(await reportDownByHand({ incidentId: INC })).toEqual({
      ok: false,
      message: 'This incident is down already, or closed.',
      stale: true,
    });
    expect(m.after).not.toHaveBeenCalled();
  });

  it('a bad id never reaches the database', async () => {
    expect((await reportDownByHand({ incidentId: 'nope' })).ok).toBe(false);
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe('Escalate now and the reminder (§30.6–7, D-055)', () => {
  it('sends the level the person saw, at once', async () => {
    m.rpc.mockResolvedValue({ data: { level: 1, notified: 2 }, error: null });
    expect(await escalateNow({ incidentId: INC, level: 1 })).toEqual({ ok: true, level: 1, notified: 2 });
    expect(m.rpc).toHaveBeenCalledWith('escalate_now', { p_incident_id: INC, p_level: 1 });
    expect(m.after).toHaveBeenCalledTimes(1);
  });

  it('two people at once: the second hears someone else did it', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: '55000', hint: 'level_moved', message: 'x' } });
    expect(await escalateNow({ incidentId: INC, level: 1 })).toEqual({
      ok: false,
      message: 'Someone else escalated it a moment ago — the page now shows the next level.',
    });
  });

  it('the home page came back while the page was open: the DOWN ladder waits (D-058)', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: '55000', hint: 'home_back', message: 'x' } });
    expect(await escalateNow({ incidentId: INC, level: 1 })).toEqual({
      ok: false,
      message: 'The home page is back — the DOWN ladder waits.',
    });
  });

  it('a level outside L1–L3 never reaches the database', async () => {
    expect((await escalateNow({ incidentId: INC, level: 4 })).ok).toBe(false);
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('the reminder goes through its SQL function and leaves at once', async () => {
    m.rpc.mockResolvedValue({ data: true, error: null });
    expect(await sendClientUpdateReminder(INC)).toEqual({ ok: true });
    expect(m.rpc).toHaveBeenCalledWith('send_client_update_reminder', { p_incident_id: INC });
    expect(m.after).toHaveBeenCalledTimes(1);
  });

  it('who may not is told who can', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'not allowed' } });
    expect(await sendClientUpdateReminder(INC)).toEqual({
      ok: false,
      message: 'Only the site’s owner, the person on call or an Admin can do this.',
    });
  });
});
