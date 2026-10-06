'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/** "Sign out" in the account footer: ends this device's session and returns to /login. */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'local' });
  redirect('/login');
}
