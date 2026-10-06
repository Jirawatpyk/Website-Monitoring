// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readAccess } from './session';

type Fake = Parameters<typeof readAccess>[0];

function fakeClient({
  claims,
  status,
  row,
}: {
  claims: Record<string, unknown> | null;
  status?: string;
  row?: Record<string, unknown>;
}) {
  const single = vi.fn().mockResolvedValue({ data: row ?? null, error: row ? null : { message: 'none' } });
  return {
    auth: { getClaims: vi.fn().mockResolvedValue({ data: claims ? { claims } : null }) },
    rpc: vi.fn().mockResolvedValue({ data: status ?? null, error: null }),
    from: vi.fn(() => ({ select: () => ({ eq: () => ({ single }) }) })),
  } as unknown as Fake;
}

describe('readAccess', () => {
  it('is signed-out without claims', async () => {
    expect(await readAccess(fakeClient({ claims: null }))).toEqual({ status: 'signed-out' });
  });

  it('returns the profile for an active user', async () => {
    const client = fakeClient({
      claims: { sub: 'u1', email: 'Arm@Example.test' },
      status: 'active',
      row: { id: 'u1', email: 'arm@example.test', display_name: 'Arm', role: 'responder' },
    });
    expect(await readAccess(client)).toEqual({
      status: 'active',
      profile: { id: 'u1', email: 'arm@example.test', displayName: 'Arm', role: 'responder' },
    });
  });

  it.each([
    ['inactive', 'inactive'],
    ['missing', 'missing'],
    [null, 'missing'],
  ])('profile status %s → %s, with the lower-cased address', async (status, expected) => {
    const client = fakeClient({
      claims: { sub: 'u1', email: 'Former@Example.test' },
      status: status ?? undefined,
    });
    expect(await readAccess(client)).toEqual({ status: expected, email: 'former@example.test' });
  });

  it('throws when the status call fails (never treats an error as access)', async () => {
    const client = fakeClient({ claims: { sub: 'u1' } });
    (client.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: { message: 'down' },
    });
    await expect(readAccess(client)).rejects.toThrow(/profile status/);
  });
});
