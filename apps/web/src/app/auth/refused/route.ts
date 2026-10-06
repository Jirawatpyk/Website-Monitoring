import { NextResponse } from 'next/server';
import { refuse } from '@/lib/auth/refuse';
import { readAccess } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Where the signed-in layout sends a session without an active profile (deactivated, or never
 * invited). It decides from the session itself — no parameters — so a link can't sign anyone out
 * who still has access.
 */
export async function GET(request: Request): Promise<Response> {
  const { origin } = new URL(request.url);
  const supabase = await createClient();
  const access = await readAccess(supabase);
  if (access.status === 'active') return NextResponse.redirect(new URL('/', origin));
  return refuse(supabase, access, origin);
}
