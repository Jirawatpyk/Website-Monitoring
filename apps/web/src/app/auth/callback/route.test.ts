// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  readAccess: vi.fn(),
  refuse: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession: mocks.exchangeCodeForSession } }),
}));
vi.mock('@/lib/auth/session', () => ({ readAccess: mocks.readAccess }));
vi.mock('@/lib/auth/refuse', () => ({ refuse: mocks.refuse }));

const call = (query: string) => GET(new Request(`http://localhost:3500/auth/callback?${query}`));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
});

describe('GET /auth/callback', () => {
  it('signs an active user in and returns them to `next`', async () => {
    mocks.readAccess.mockResolvedValue({ status: 'active', profile: {} });
    const res = await call('code=abc&next=%2Fincidents%2Fx');
    expect(res.headers.get('location')).toBe('http://localhost:3500/incidents/x');
  });

  it('never redirects off-site, whatever `next` says', async () => {
    mocks.readAccess.mockResolvedValue({ status: 'active', profile: {} });
    const res = await call('code=abc&next=%2F%2Fevil.example');
    expect(res.headers.get('location')).toBe('http://localhost:3500/');
  });

  it('refuses a session without an active profile', async () => {
    mocks.readAccess.mockResolvedValue({ status: 'inactive', email: 'a@b.c' });
    mocks.refuse.mockResolvedValue(new Response(null, { status: 307, headers: { location: 'x' } }));
    await call('code=abc');
    expect(mocks.refuse).toHaveBeenCalledOnce();
  });

  it('maps a sign-up hook refusal to the no-access card', async () => {
    const res = await call(
      "error=access_denied&error_description=You're+not+on+the+DxT+Monitor+access+list+yet.+Ask+an+Admin+to+add+you.",
    );
    expect(res.headers.get('location')).toBe('http://localhost:3500/login?error=access');
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('shows the generic error when the code exchange fails or there is no code', async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: { message: 'bad code' } });
    expect((await call('code=bad')).headers.get('location')).toBe('http://localhost:3500/login?error=auth');
    expect((await call('')).headers.get('location')).toBe('http://localhost:3500/login?error=auth');
  });
});
