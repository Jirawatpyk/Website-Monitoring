import 'server-only';
import { cache } from 'react';
import type { Role } from '@dxt/shared';
import { createClient } from '@/lib/supabase/server';

export interface CurrentProfile {
  id: string;
  email: string;
  displayName: string;
  role: Role;
}

/**
 * What the signed-in person may do, once per request (D-007): `active` with their profile, or why
 * not — `inactive` (deactivated by an Admin), `missing` (no profile: never on the allowlist) or
 * `signed-out`. RLS hides an inactive profile, so the status comes from `my_profile_status()`.
 */
export type Access =
  | { status: 'active'; profile: CurrentProfile }
  | { status: 'inactive' | 'missing'; email: string | null }
  | { status: 'signed-out' };

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export async function readAccess(supabase: ServerClient): Promise<Access> {
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims) return { status: 'signed-out' };
  const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : null;

  const { data: status, error } = await supabase.rpc('my_profile_status');
  if (error) throw new Error(`Could not read profile status: ${error.message}`);
  if (status !== 'active') return { status: status === 'inactive' ? 'inactive' : 'missing', email };

  const { data: row, error: rowError } = await supabase
    .from('profiles')
    .select('id, email, display_name, role')
    .eq('id', claims.sub)
    .single();
  if (rowError) throw new Error(`Could not read profile: ${rowError.message}`);
  return {
    status: 'active',
    profile: { id: row.id, email: row.email, displayName: row.display_name, role: row.role },
  };
}

/** Access for the current request (deduplicated across layout, page and components). */
export const getAccess = cache(async (): Promise<Access> => readAccess(await createClient()));
