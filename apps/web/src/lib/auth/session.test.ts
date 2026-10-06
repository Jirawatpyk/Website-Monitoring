// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readAccess } from './session';

type Fake = Parameters<typeof readAccess>[0];

function fakeClient({
  claims,
  access,
  error = null,
}: {
  claims: Record<string, unknown> | null;
  access?: Record<string, unknown>;
  error?: { message: string } | null;
}) {
  const single = vi.fn().mockResolvedValue({ data: access ?? null, error });
  return {
    auth: { getClaims: vi.fn().mockResolvedValue({ data: claims ? { claims } : null }) },
    rpc: vi.fn(() => ({ single })),
  } as unknown as Fake;
}

const none = { id: null, email: null, display_name: null, role: null };

describe('readAccess', () => {
  it('is signed-out without claims', async () => {
    expect(await readAccess(fakeClient({ claims: null }))).toEqual({ status: 'signed-out' });
  });

  it('returns the profile for an active user from one my_access call', async () => {
    const client = fakeClient({
      claims: { sub: 'u1', email: 'Arm@Example.test' },
      access: {
        status: 'active',
        id: 'u1',
        email: 'arm@example.test',
        display_name: 'Arm',
        role: 'responder',
      },
    });
    expect(await readAccess(client)).toEqual({
      status: 'active',
      profile: { id: 'u1', email: 'arm@example.test', displayName: 'Arm', role: 'responder' },
    });
    expect(client.rpc).toHaveBeenCalledOnce();
    expect(client.rpc).toHaveBeenCalledWith('my_access');
  });

  it.each([
    ['inactive', 'inactive'],
    ['missing', 'missing'],
  ])('status %s → %s, with the lower-cased address', async (status, expected) => {
    const client = fakeClient({
      claims: { sub: 'u1', email: 'Former@Example.test' },
      access: { status, ...none },
    });
    expect(await readAccess(client)).toEqual({ status: expected, email: 'former@example.test' });
  });

  it('throws when the access call fails (never treats an error as access)', async () => {
    const client = fakeClient({ claims: { sub: 'u1' }, error: { message: 'down' } });
    await expect(readAccess(client)).rejects.toThrow(/Could not read access/);
  });
});
