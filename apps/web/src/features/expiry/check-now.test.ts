// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '@dxt/db';
import type { Access } from '@/lib/auth/session';
import { fakeDb, type FakeCall } from '../../../test/fake-db';
import { CHECK_NOW_GUARD_MS, checkNowHandler } from './check-now';

const admin: Access = {
  status: 'active',
  profile: { id: 'u1', email: 'a@x.test', displayName: 'Tao', role: 'admin' },
};
const as = (role: string) => ({ ...admin, profile: { ...admin.profile, role } }) as Access;
const NOW = Date.parse('2026-11-18T03:07:00Z');

/** The newest SSL / domain checked_at, as the two ordered reads see them. */
function db(ssl: string | null, domain: string | null = ssl) {
  return fakeDb({
    'site_expiry.select': (call: FakeCall) => {
      const col = call.filters.some((f) => f.includes('ssl_checked_at'))
        ? 'ssl_checked_at'
        : 'domain_checked_at';
      const v = col === 'ssl_checked_at' ? ssl : domain;
      return { data: v ? [{ [col]: v }] : [] };
    },
  }).db as unknown as DbClient;
}

function handler(
  access: Access,
  client = db(null),
  result: Record<string, unknown> = { ok: true, read: 17 },
) {
  const run = vi.fn(async () => ({ ok: true, ...result }));
  const POST = checkNowHandler({ access: async () => access, db: () => client, run, clock: () => NOW });
  return { POST, run };
}

describe('Check now route (D-066 item 4)', () => {
  it('reads every live site and says how many it read', async () => {
    const { POST, run } = handler(admin);
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, read: 17, failed: [] });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ all: true }));
  });

  it('a Responder may press it; a Stakeholder, a Viewer and a signed-out person may not', async () => {
    expect((await handler(as('responder')).POST()).status).toBe(200);
    for (const role of ['stakeholder', 'viewer', 'client']) {
      const { POST, run } = handler(as(role));
      expect((await POST()).status).toBe(403);
      expect(run).not.toHaveBeenCalled();
    }
    const out = handler({ status: 'signed_out' } as unknown as Access);
    expect((await out.POST()).status).toBe(401);
    expect(out.run).not.toHaveBeenCalled();
  });

  it('refuses inside a minute of the newest check, whichever half it was', async () => {
    const recent = new Date(NOW - CHECK_NOW_GUARD_MS + 5_000).toISOString();
    const old = new Date(NOW - 3_600_000).toISOString();
    for (const client of [db(recent, old), db(old, recent)]) {
      const { POST, run } = handler(admin, client);
      const res = await POST();
      expect(res.status).toBe(429);
      expect((await res.json()).error).toMatch(/less than a minute ago/);
      expect(run).not.toHaveBeenCalled();
    }
    expect((await handler(admin, db(old)).POST()).status).toBe(200);
  });

  it('names the sites it could not read, and a wrong region in words', async () => {
    const failed = await handler(admin, db(null), { ok: false, read: 17, failed: ['Cando Asia'] }).POST();
    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({ failed: ['Cando Asia'] });
    const region = await handler(admin, db(null), { ok: false, skipped: 'wrong_region' }).POST();
    expect(region.status).toBe(503);
  });
});
