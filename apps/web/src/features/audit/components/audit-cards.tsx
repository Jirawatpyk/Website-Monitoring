import { useEffect, useRef, useState } from 'react';
import { Avatar, Button, Dialog } from '@jirawatpyk/aura-react';
import { IconLock, IconMonitor, IconX } from '@jirawatpyk/aura-react/icons';
import type { AuditEntry } from '../queries';
import { fullAtLabel } from '../model';

/** Cards shown at a time on a phone (§33.8; desktop keeps 50 a page). */
export const CARD_PAGE = 25;

function Actor({ name }: { name: string }) {
  // "System" gets a neutral circle with the monitor icon, never an avatar of the word (§33.6).
  return name === 'System' ? (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-bg-surface-hover text-fg-secondary">
      <IconMonitor size="sm" aria-hidden />
    </span>
  ) : (
    <Avatar name={name} size="sm" />
  );
}

/**
 * MAuditLog's entry list (§33.6–9): one card per entry in one rounded list, never a table; a card
 * opens a sheet with every field in full; 25 at a time with "Show N more" (focus moves to the first
 * new card). `resetKey` (the filters) puts it back to 25.
 */
export function AuditCards({
  entries,
  narrowed,
  resetKey,
  onClear,
}: {
  entries: AuditEntry[];
  narrowed: boolean;
  resetKey: string;
  onClear: () => void;
}) {
  const [shown, setShown] = useState(CARD_PAGE);
  const [seenKey, setSeenKey] = useState(resetKey);
  if (seenKey !== resetKey) {
    setSeenKey(resetKey);
    setShown(CARD_PAGE);
  }
  const [open, setOpen] = useState<AuditEntry | null>(null);
  const cards = useRef<(HTMLButtonElement | null)[]>([]);
  const focusAt = useRef<number | null>(null);
  useEffect(() => {
    if (focusAt.current === null) return;
    cards.current[focusAt.current]?.focus();
    focusAt.current = null;
  }, [shown]);

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-aura-lg border border-border-default bg-bg-surface px-4 py-6 text-center">
        <span className="text-sm font-medium">
          {narrowed ? 'No entries match these filters.' : 'Nothing logged in this range.'}
        </span>
        {narrowed && (
          <Button variant="secondary" icon={<IconX />} onClick={onClear}>
            Clear filters
          </Button>
        )}
      </div>
    );
  }

  const visible = entries.slice(0, shown);
  const left = entries.length - visible.length;
  return (
    <>
      <ul className="m-0 list-none overflow-hidden rounded-aura-lg border border-border-default bg-bg-surface p-0">
        {visible.map((e, i) => (
          <li key={e.id} className="border-b border-border-subtle last:border-b-0">
            <button
              type="button"
              ref={(el) => {
                cards.current[i] = el;
              }}
              onClick={() => setOpen(e)}
              aria-label={`${e.words}, ${e.atLabel}, ${e.actor}, ${e.entity}. Open the full entry`}
              className="flex w-full cursor-pointer flex-col gap-1.5 border-0 bg-transparent px-3.5 py-3 text-left text-fg-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
            >
              <span className="flex items-baseline justify-between gap-2.5 leading-snug">
                <span className="text-sm font-semibold">{e.words}</span>
                <span className="shrink-0 font-mono text-xs text-fg-secondary tabular-nums">{e.atLabel}</span>
              </span>
              <span className="flex min-w-0 items-center gap-2 text-sm leading-snug">
                <Actor name={e.actor} />
                <span className="shrink-0 font-medium">{e.actor}</span>
                <span className="text-fg-tertiary" aria-hidden>
                  ·
                </span>
                <span className="min-w-0 truncate text-fg-secondary">{e.entity}</span>
              </span>
              <span className="flex flex-col gap-0.5 rounded-aura-sm bg-bg-canvas px-2 py-1.5 font-mono text-xs leading-normal">
                {e.struck && (
                  <span className="line-clamp-2 break-words text-fg-secondary line-through">{e.before}</span>
                )}
                <span className="flex min-w-0 gap-1.5">
                  <span className="shrink-0 text-fg-tertiary" aria-hidden>
                    →
                  </span>
                  <span className="line-clamp-2 min-w-0 break-words">{e.after}</span>
                </span>
              </span>
              <span className="font-mono text-xs leading-snug text-fg-tertiary">{e.action}</span>
            </button>
          </li>
        ))}
      </ul>
      {left > 0 && (
        <div className="flex flex-col items-stretch gap-1">
          <Button
            variant="secondary"
            fullWidth
            onClick={() => {
              focusAt.current = shown;
              setShown(shown + CARD_PAGE);
            }}
          >
            {`Show ${Math.min(CARD_PAGE, left)} more`}
          </Button>
          <span className="text-center text-xs text-fg-secondary">{`${visible.length} of ${entries.length} shown`}</span>
        </div>
      )}
      <Dialog
        open={open !== null}
        onClose={() => setOpen(null)}
        size="sm"
        title={open?.words ?? ''}
        description={open ? fullAtLabel(new Date(open.at)) : ''}
      >
        {open && (
          <div className="flex flex-col gap-3">
            <dl className="m-0 flex flex-col gap-3 text-sm leading-normal">
              {[
                [
                  'Actor',
                  open.actor === 'System'
                    ? 'System — written by the status engine or the notifier'
                    : open.actor,
                  '',
                ],
                ['Entity', open.entity, ''],
                [
                  'Before',
                  open.before,
                  `font-mono text-xs break-words text-fg-secondary ${open.struck ? 'line-through' : ''}`,
                ],
                ['After', open.after, 'font-mono text-xs break-words'],
                ['Action', `${open.action} · ${open.category ?? 'Other'}`, 'font-mono text-xs'],
              ].map(([k, v, cls]) => (
                <div key={k} className="flex flex-col gap-0.5">
                  <dt className="text-xs text-fg-secondary">{k}</dt>
                  <dd className={`m-0 ${cls}`}>{v}</dd>
                </div>
              ))}
            </dl>
            <span className="flex gap-1.5 text-xs text-fg-secondary">
              <span className="flex pt-0.5">
                <IconLock size="sm" aria-hidden />
              </span>
              Can’t be edited or deleted.
            </span>
            <Button variant="secondary" fullWidth onClick={() => setOpen(null)}>
              Close
            </Button>
          </div>
        )}
      </Dialog>
    </>
  );
}
