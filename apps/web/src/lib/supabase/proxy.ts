import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@dxt/db';
import { isAllowedEmail } from '@dxt/shared';
import { loginErrorFromCallback, refusedEmailCookie } from '@/lib/auth/login-errors';
import { isPublic } from '@/lib/auth/public-paths';

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
    // Supabase Auth may send an OAuth refusal (e.g. the sign-up hook) to the Site URL instead of
    // /auth/callback: show the refusal rather than a sign-in loop.
    if (request.nextUrl.searchParams.has('error_description')) {
      url.search = `?error=${loginErrorFromCallback(request.nextUrl.searchParams)}`;
      return NextResponse.redirect(url);
    }
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
    // The login page names the account that was refused (D-011) — via a cookie, never the URL.
    if (email) redirect.cookies.set(refusedEmailCookie(email.toLowerCase()));
    return redirect;
  }

  return response;
}
