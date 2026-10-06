/**
 * Paths reachable without a session, matched per path segment (`/login` matches `/login` and
 * `/login/…`, never `/login-x`). Each API route listed here checks its own bearer token; any new
 * `/api/*` route needs a session unless it is added here on purpose.
 */
export const PUBLIC_PATHS = [
  '/login',
  '/auth/sign-in',
  '/auth/callback',
  '/status',
  '/api/cron',
  '/api/ingest',
  '/api/jobs',
] as const;

export function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
