import { describe, expect, it } from 'vitest';
import {
  loginErrorFromCallback,
  parseLoginError,
  parseRefusedEmail,
  refusedEmailCookie,
} from './login-errors';

describe('loginErrorFromCallback — Supabase refusals sent back to /auth/callback', () => {
  it.each([
    [
      "error=access_denied&error_description=You're+not+on+the+DxT+Monitor+access+list+yet.+Ask+an+Admin+to+add+you.",
      'access',
    ],
    [
      'error=server_error&error_description=Only+DxT+Google+accounts+can+sign+in.+Ask+an+Admin+if+you+need+access.',
      'domain',
    ],
    ['error=access_denied&error_description=User+cancelled', 'auth'],
    ['error=server_error', 'auth'],
  ])('%s → %s', (query, expected) => {
    expect(loginErrorFromCallback(new URLSearchParams(query))).toBe(expected);
  });
});

describe('parseLoginError', () => {
  it('accepts the known reasons only', () => {
    expect(parseLoginError('domain')).toBe('domain');
    expect(parseLoginError('deactivated')).toBe('deactivated');
    expect(parseLoginError('nope')).toBeNull();
    expect(parseLoginError(['domain'])).toBeNull();
    expect(parseLoginError(undefined)).toBeNull();
  });
});

describe('parseRefusedEmail', () => {
  it('shows one address, lower-cased, and ignores anything else', () => {
    expect(parseRefusedEmail('Someone@Gmail.com')).toBe('someone@gmail.com');
    expect(parseRefusedEmail('<script>@x')).toBe('<script>@x'); // React escapes it; still one address
    expect(parseRefusedEmail('two words@x.com')).toBeNull();
    expect(parseRefusedEmail('no-at-sign')).toBeNull();
    expect(parseRefusedEmail('a'.repeat(250) + '@x.com')).toBeNull();
    expect(parseRefusedEmail(undefined)).toBeNull();
  });
});

describe('refusedEmailCookie', () => {
  it('is httpOnly, scoped to /login and short-lived', () => {
    expect(refusedEmailCookie('a@b.c')).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/login',
      maxAge: 60,
    });
  });
});
