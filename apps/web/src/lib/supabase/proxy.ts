import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@dxt/db';
import { isAllowedEmail } from '@dxt/shared';

/**
 * Paths reachable without a session, matched per path segment (`/login` matches `/login` and
 * `/login/…`, never `/login-x`). Each API route listed here checks its own bearer token; any new
 * `/api/*` route needs a session unless it is added here on purpose.
 */
const PUBLIC_PATHS = ['/login', '/auth/callback', '/status', '/api/cron', '/api/ingest', '/api/jobs'];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Refreshes the Supabase session cookie on every request, sends signed-out people to /login, and
 * rejects sessions from outside the company domain (PRD §3). The database hook that blocks such
 * sign-ups is the first line; this is the second.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // Don't remove: getClaims() validates the JWT and triggers the refresh.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const { pathname, search } = request.nextUrl;

  if (isPublic(pathname)) return response;

  if (!claims) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Keep the alert link so sign-in returns to the incident (MLogin board).
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  const email = typeof claims.email === 'string' ? claims.email : null;
  if (!isAllowedEmail(email, process.env.ALLOWED_EMAIL_DOMAIN)) {
    await supabase.auth.signOut();
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '?error=domain';
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  return response;
}
