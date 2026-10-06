import 'server-only';
import { cache } from 'react';
import type { Role } from '@dxt/shared';
import { createClient, type ServerClient } from '@/lib/supabase/server';

export interface CurrentProfile {
  id: string;
  email: string;
  displayName: string;
  role: Role;
}

/**
 * What the signed-in person may do, once per request (D-007): `active` with their profile, or why
 * not — `inactive` (deactivated by an Admin), `missing` (no profile: never on the allowlist) or
 * `signed-out`. RLS hides an inactive profile, so status and profile come from `my_access()` —
 * one database call per request.
 */
export type Access =
  | { status: 'active'; profile: CurrentProfile }
  | { status: 'inactive' | 'missing'; email: string | null }
  | { status: 'signed-out' };

export async function readAccess(supabase: ServerClient): Promise<Access> {
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims) return { status: 'signed-out' };
  const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : null;

  const { data, error } = await supabase.rpc('my_access').single();
  if (error) throw new Error(`Could not read access: ${error.message}`);
  if (data.status === 'active' && data.id && data.email && data.display_name && data.role) {
    return {
      status: 'active',
      profile: { id: data.id, email: data.email, displayName: data.display_name, role: data.role },
    };
  }
  return { status: data.status === 'inactive' ? 'inactive' : 'missing', email };
}

/** Access for the current request (deduplicated across layout, page and components). */
export const getAccess = cache(async (): Promise<Access> => readAccess(await createClient()));
