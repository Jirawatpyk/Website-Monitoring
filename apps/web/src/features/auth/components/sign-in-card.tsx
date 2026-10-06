import { Alert, Button, Card } from '@jirawatpyk/aura-react';
import { IconBell, IconClock } from '@jirawatpyk/aura-react/icons';
import { signInHref } from '../sign-in-href';

interface SignInCardProps {
  /** Where to go after signing in (already safe). */
  next: string;
  /** The last attempt didn't finish (`?error=auth`). */
  failed?: boolean;
}

/** "Sign in" state of the Login / MLogin boards. */
export function SignInCard({ next, failed = false }: SignInCardProps) {
  return (
    <Card className="w-full max-w-md">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 font-display text-3xl leading-tight font-semibold">Sign in</h1>
          <p className="m-0 text-sm text-fg-secondary">
            {next === '/'
              ? 'Use your DxT Google account.'
              : 'Use your DxT Google account. You’ll go straight back to the page you opened.'}
          </p>
        </div>
        {failed && (
          <Alert tone="danger" title="Sign-in didn’t finish">
            Try again. If it keeps failing, ask an Admin.
          </Alert>
        )}
        {/* A plain <a>: a router link could prefetch the sign-in route and start OAuth on its own. */}
        <Button href={signInHref(next)} linkComponent="a" fullWidth>
          Sign in with Google
        </Button>
        <ul className="m-0 flex list-none flex-col gap-2.5 border-t border-border-default p-0 pt-4 text-sm text-fg-secondary">
          <li className="flex gap-2.5">
            <IconBell aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>Came from an alert? You’ll go straight back to that incident.</span>
          </li>
          <li className="flex gap-2.5">
            <IconClock aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>You stay signed in on this device.</span>
          </li>
        </ul>
      </div>
    </Card>
  );
}
