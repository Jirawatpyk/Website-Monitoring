import { NextResponse } from 'next/server';
import { safeNextPath } from '@dxt/shared';
import { refuse } from '@/lib/auth/refuse';
import { loginErrorFromCallback } from '@/lib/auth/login-errors';
import { readAccess } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Google SSO lands here with `?code=…&next=…`, or with `?error=…` when Supabase refused — e.g. the
 * sign-up hook said the address isn't on the access list (D-007). Exchange the code for a session
 * cookie, then go to `next` (same-origin paths only) if the person has an active profile.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = safeNextPath(url.searchParams.get('next'));

  if (!code) {
    const reason = url.searchParams.has('error') ? loginErrorFromCallback(url.searchParams) : 'auth';
    return NextResponse.redirect(new URL(`/login?error=${reason}`, url.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL('/login?error=auth', url.origin));

  const access = await readAccess(supabase);
  if (access.status === 'active') return NextResponse.redirect(new URL(next, url.origin));
  return refuse(supabase, access, url.origin);
}
