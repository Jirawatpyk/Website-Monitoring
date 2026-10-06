'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { loginErrorFromCallback } from '@/lib/auth/login-errors';

/**
 * Supabase Auth can put an OAuth refusal in the URL fragment (`#error_description=…`), which never
 * reaches the server; browsers keep the fragment across the callback's redirect to /login. Read it
 * here and show the matching card (e.g. "No access yet" from the sign-up hook, D-007).
 */
export function FragmentError() {
  const router = useRouter();
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (!hash.has('error') && !hash.has('error_description')) return;
    const params = new URLSearchParams(window.location.search);
    params.set('error', loginErrorFromCallback(hash));
    router.replace(`/login?${params.toString()}`);
  }, [router]);
  return null;
}
