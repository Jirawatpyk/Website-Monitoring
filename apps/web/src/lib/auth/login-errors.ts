/**
 * Why /login is showing a refusal (D-007, D-011). The reason travels in `?error=`; the refused
 * address, when known, travels in a short-lived httpOnly cookie — never in the URL.
 */
export const LOGIN_ERRORS = ['domain', 'access', 'deactivated', 'auth'] as const;
export type LoginError = (typeof LOGIN_ERRORS)[number];

export const REFUSED_EMAIL_COOKIE = 'dxt_refused_email';
export const REFUSED_EMAIL_MAX_AGE_SEC = 60;

/** Cookie options for the refused address: readable only by the /login page, gone after a minute. */
export const refusedEmailCookie = (email: string) => ({
  name: REFUSED_EMAIL_COOKIE,
  value: email,
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/login',
  maxAge: REFUSED_EMAIL_MAX_AGE_SEC,
});

export function parseLoginError(value: string | string[] | undefined | null): LoginError | null {
  return typeof value === 'string' && (LOGIN_ERRORS as readonly string[]).includes(value)
    ? (value as LoginError)
    : null;
}

/** Shown only if it looks like one address; anything else is ignored. */
export function parseRefusedEmail(value: string | undefined | null): string | null {
  return value && value.length <= 254 && /^[^@\s]+@[^@\s]+$/.test(value) ? value.toLowerCase() : null;
}

/**
 * Supabase Auth sends errors back to /auth/callback as query parameters. The sign-up hook's
 * refusal message (migration 20261006000001) tells us which refusal it was.
 */
export function loginErrorFromCallback(params: URLSearchParams): LoginError {
  const text = `${params.get('error_description') ?? ''} ${params.get('error') ?? ''}`;
  if (/access list/i.test(text)) return 'access';
  if (/only dxt google accounts/i.test(text)) return 'domain';
  return 'auth';
}
