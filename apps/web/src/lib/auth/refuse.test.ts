// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { refuse } from './refuse';

const jar = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => jar }));

const signOut = vi.fn().mockResolvedValue({ error: null });
const client = { auth: { signOut } } as unknown as Parameters<typeof refuse>[0];

beforeEach(() => vi.clearAllMocks());

describe('refuse', () => {
  it('signs a deactivated user out and shows the deactivated card with their address', async () => {
    const res = await refuse(client, { status: 'inactive', email: 'former@example.test' }, 'http://x');
    expect(res.headers.get('location')).toBe('http://x/login?error=deactivated');
    expect(signOut).toHaveBeenCalledOnce();
    expect(jar.set).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'former@example.test', httpOnly: true }),
    );
  });

  it('signs out a user with no profile and shows the no-access card', async () => {
    const res = await refuse(client, { status: 'missing', email: null }, 'http://x');
    expect(res.headers.get('location')).toBe('http://x/login?error=access');
    expect(signOut).toHaveBeenCalledOnce();
    expect(jar.set).not.toHaveBeenCalled();
  });

  it('has nothing to sign out when there is no session', async () => {
    const res = await refuse(client, { status: 'signed-out' }, 'http://x');
    expect(res.headers.get('location')).toBe('http://x/login?error=auth');
    expect(signOut).not.toHaveBeenCalled();
  });
});
