import type { ReactNode } from 'react';
import { Alert, Button, Card } from '@jirawatpyk/aura-react';
import { IconArrowLeft } from '@jirawatpyk/aura-react/icons';
import type { LoginError } from '@/lib/auth/login-errors';
import { signInHref } from '../sign-in-href';

type Refusal = Exclude<LoginError, 'auth'>;

interface RefusalCardProps {
  reason: Refusal;
  /** The refused address when we know it (short-lived cookie, D-011). */
  email: string | null;
  next: string;
}

const Address = ({ email }: { email: string }) => <b className="text-fg-primary">{email}</b>;

/** Copy per D-007 / D-011: no invite email, no names — the Admin adds people to the access list. */
const COPY: Record<
  Refusal,
  { title: string; lede: (email: string | null) => ReactNode; alertTitle: string; alert: string }
> = {
  domain: {
    title: 'This account can’t sign in',
    lede: (email) =>
      email ? (
        <>
          You used <Address email={email} />. Only DxT Google accounts can sign in.
        </>
      ) : (
        'That account isn’t a DxT Google account. Only DxT Google accounts can sign in.'
      ),
    alertTitle: 'Client or partner?',
    alert:
      'Uptime for your own sites is on your status page and in the monthly report. Ask your DxT account manager for the link.',
  },
  access: {
    title: 'No access yet',
    lede: (email) =>
      email ? (
        <>
          <Address email={email} /> is a DxT account, but it isn’t on the DxT Monitor access list yet.
        </>
      ) : (
        'Your DxT account isn’t on the DxT Monitor access list yet.'
      ),
    alertTitle: 'Ask an Admin to add you',
    alert: 'An Admin adds people and picks their role. Once you’re added, sign in again.',
  },
  deactivated: {
    title: 'Account deactivated',
    lede: (email) => (
      <>
        {email ? <Address email={email} /> : 'This account'} was deactivated by an Admin. It can’t see sites,
        incidents or reports any more.
      </>
    ),
    alertTitle: 'Think this is a mistake?',
    alert:
      'Ask an Admin to reactivate it. Your past acknowledgements and notes stay in the audit log either way.',
  },
};

/** "Wrong domain", "No access yet" and "Deactivated" states of the Login / MLogin boards. */
export function RefusalCard({ reason, email, next }: RefusalCardProps) {
  const copy = COPY[reason];
  return (
    <Card className="w-full max-w-md">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 font-display text-2xl leading-tight font-semibold">{copy.title}</h1>
          <p className="m-0 text-sm text-fg-secondary">{copy.lede(email)}</p>
        </div>
        <Alert tone="info" title={copy.alertTitle}>
          {copy.alert}
        </Alert>
        <Button
          href={signInHref(next)}
          linkComponent="a"
          variant="secondary"
          icon={<IconArrowLeft />}
          fullWidth
        >
          Use a different account
        </Button>
      </div>
    </Card>
  );
}
