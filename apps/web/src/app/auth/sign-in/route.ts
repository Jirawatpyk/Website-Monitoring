import { NextResponse } from 'next/server';
import { safeNextPath } from '@dxt/shared';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * "Sign in with Google": start Supabase's Google OAuth flow (PKCE — the verifier goes into a
 * cookie here) and send the browser to Google. A plain link, not a form, so the redirect chain
 * isn't limited by CSP `form-action`. `next` survives the round trip (MLogin board).
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get('next'));
  const callback = new URL('/auth/callback', url.origin);
  if (next !== '/') callback.searchParams.set('next', next);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: callback.toString(),
      skipBrowserRedirect: true,
      queryParams: {
        // Always show Google's account chooser so "Use a different account" works.
        prompt: 'select_account',
        ...(process.env.ALLOWED_EMAIL_DOMAIN ? { hd: process.env.ALLOWED_EMAIL_DOMAIN } : {}),
      },
    },
  });

  if (error || !data.url) return NextResponse.redirect(new URL('/login?error=auth', url.origin));
  return NextResponse.redirect(data.url);
}
