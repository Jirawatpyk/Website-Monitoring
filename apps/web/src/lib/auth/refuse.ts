import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { refusedEmailCookie, type LoginError } from './login-errors';
import type { Access } from './session';
import type { ServerClient } from '@/lib/supabase/server';

/**
 * Sign a session out that may not use the app, and show /login with the reason (D-007, D-011).
 * The address goes into a short-lived httpOnly cookie, never into the URL.
 */
export async function refuse(
  supabase: ServerClient,
  access: Exclude<Access, { status: 'active' }>,
  origin: string,
): Promise<Response> {
  const reason: LoginError =
    access.status === 'inactive' ? 'deactivated' : access.status === 'missing' ? 'access' : 'auth';
  if (access.status !== 'signed-out') {
    await supabase.auth.signOut();
    if (access.email) (await cookies()).set(refusedEmailCookie(access.email));
  }
  return NextResponse.redirect(new URL(`/login?error=${reason}`, origin));
}
