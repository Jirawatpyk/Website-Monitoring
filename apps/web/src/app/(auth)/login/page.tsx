import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { safeNextPath } from '@dxt/shared';
import { BrandMark } from '@/components/app-shell/brand';
import { BrandPanel, FragmentError, RefusalCard, SignInCard } from '@/features/auth';
import { parseLoginError, parseRefusedEmail, REFUSED_EMAIL_COOKIE } from '@/lib/auth/login-errors';
import { getAccess } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Sign in' };

/**
 * Sign in — boards `Login` (desktop) and `MLogin` (390). Google Workspace SSO only (D-007).
 * `?next=` goes through `safeNextPath`; `?error=` picks the refusal card (domain from the proxy,
 * access / deactivated from the callback, auth for anything else).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === 'string' ? params.next : null);
  const error = parseLoginError(params.error);

  if (!error && (await getAccess()).status === 'active') redirect(next);

  const email =
    error && error !== 'auth' ? parseRefusedEmail((await cookies()).get(REFUSED_EMAIL_COOKIE)?.value) : null;

  return (
    <div className="flex min-h-dvh bg-bg-canvas text-fg-primary">
      <FragmentError />
      <BrandPanel />
      <div className="flex min-w-0 grow flex-col">
        <header className="flex h-14 items-center px-4 lg:hidden">
          <BrandMark />
        </header>
        <main className="flex grow items-start justify-center px-4 py-6 sm:items-center sm:py-12">
          {error && error !== 'auth' ? (
            <RefusalCard reason={error} email={email} next={next} />
          ) : (
            <SignInCard next={next} failed={error === 'auth'} />
          )}
        </main>
      </div>
    </div>
  );
}
