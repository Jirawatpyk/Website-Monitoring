import { NextResponse } from 'next/server';
import { safeNextPath } from '@dxt/shared';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Google SSO lands here with `?code=…&next=…`. Exchange the code for a session cookie, then go to
 * `next` (same-origin paths only). The proxy re-checks the company domain on the next request.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = safeNextPath(url.searchParams.get('next'));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }

  return NextResponse.redirect(new URL('/login?error=auth', url.origin));
}
