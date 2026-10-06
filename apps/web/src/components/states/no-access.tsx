import { Alert, Avatar } from '@jirawatpyk/aura-react';

export interface PersonWhoCanAct {
  name: string;
  /** e.g. "owner", "backup (L1)", "Admin (L1)". */
  duty: string;
  /** e.g. "Not acked", "Notified 10:03". */
  status: string;
  /** Show the status in the danger colour (someone is still being chased). */
  urgent?: boolean;
}

interface NoAccessProps {
  /** e.g. "You can see this, not acknowledge it". */
  title: string;
  /** Who they are signed in as and why they can't act. */
  description: string;
  /** Who can act instead — never a bare 403. */
  people?: PersonWhoCanAct[];
}

/**
 * No access (EmptyStates board, panel 5): the content stays visible read-only above this, and the
 * notice names who can act. Used wherever a role can see something but not change it.
 */
export function NoAccess({ title, description, people = [] }: NoAccessProps) {
  return (
    <div className="flex flex-col gap-4">
      <Alert tone="info" title={title}>
        {description}
      </Alert>
      {people.length > 0 && (
        <section aria-labelledby="who-can-act" className="flex flex-col gap-2">
          <h2 id="who-can-act" className="m-0 text-sm font-semibold">
            Who can act now
          </h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {people.map((person) => (
              <li key={`${person.name}-${person.duty}`} className="flex min-h-11 items-center gap-3">
                <Avatar name={person.name} size="sm" />
                <span className="grow text-sm">
                  {person.name} — {person.duty}
                </span>
                <span className={`text-sm ${person.urgent ? 'text-fg-danger' : 'text-fg-secondary'}`}>
                  {person.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
