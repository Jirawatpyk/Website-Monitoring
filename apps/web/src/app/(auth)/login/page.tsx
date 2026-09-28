import type { Metadata } from 'next';
import { Container } from '@jirawatpyk/aura-react';

export const metadata: Metadata = { title: 'Sign in' };

/**
 * Sign in — boards `Login` and `MLogin`. Google Workspace SSO only; `?next=` must go through
 * `safeNextPath` from `@dxt/shared`; `?error=domain` means the proxy rejected a non-company account.
 * Not built yet: run /implement-screen Login.
 */
export default function LoginPage() {
  return (
    <Container>
      <div className="flex flex-col gap-1 py-8">
        <h1 className="m-0 font-display text-4xl font-semibold">Sign in</h1>
      </div>
    </Container>
  );
}
