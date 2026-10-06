/** Link that starts Google sign-in and comes back to `next` (already checked with safeNextPath). */
export function signInHref(next: string): string {
  return next === '/' ? '/auth/sign-in' : `/auth/sign-in?next=${encodeURIComponent(next)}`;
}
