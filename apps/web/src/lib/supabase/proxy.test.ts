// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubServerEnv } from '../../../test/env';
import { updateSession } from './proxy';

// Supabase is replaced by a fake whose session we control.
const auth = vi.hoisted(() => ({ getClaims: vi.fn(), signOut: vi.fn() }));
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth }) }));

const signedInAs = (email: string | null) =>
  auth.getClaims.mockResolvedValue({ data: email === null ? null : { claims: { email } } });

const visit = (path: string) => updateSession(new NextRequest(`http://localhost:3500${path}`));

beforeEach(() => {
  stubServerEnv();
  auth.signOut.mockResolvedValue({ error: null });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('updateSession (auth proxy)', () => {
  it('sends signed-out people to /login and keeps where they were going', async () => {
    signedInAs(null);
    const response = await visit('/incidents/INC-1?ack=1');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://localhost:3500/login?next=%2Fincidents%2FINC-1%3Fack%3D1',
    );
  });

  it('lets public paths through without a session', async () => {
    signedInAs(null);
    const response = await visit('/api/cron/engine');
    expect(response.headers.get('location')).toBeNull();
  });

  it('lets a company account through', async () => {
    signedInAs('arm@dxt.example');
    const response = await visit('/incidents');
    expect(response.headers.get('location')).toBeNull();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('signs out and rejects an account from another domain', async () => {
    signedInAs('someone@gmail.com');
    const response = await visit('/incidents');
    expect(response.headers.get('location')).toBe('http://localhost:3500/login?error=domain');
    expect(auth.signOut).toHaveBeenCalledOnce();
    const cookie = response.cookies.get('dxt_refused_email');
    expect(cookie?.value).toBe('someone@gmail.com');
    expect(cookie).toMatchObject({ httpOnly: true, path: '/login', maxAge: 60 });
  });

  it('rejects everyone when ALLOWED_EMAIL_DOMAIN is not set (fail closed)', async () => {
    stubServerEnv({ ALLOWED_EMAIL_DOMAIN: '' });
    signedInAs('arm@dxt.example');
    const response = await visit('/');
    expect(response.headers.get('location')).toBe('http://localhost:3500/login?error=domain');
  });
});
