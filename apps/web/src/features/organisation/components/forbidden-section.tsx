'use client';

import { Alert, Button, Dialog, Select, Tag, Textarea, TextField } from '@jirawatpyk/aura-react';
import {
  IconBan,
  IconCircleCheck,
  IconEye,
  IconLoaderCircle,
  IconPlus,
  IconSearch,
  IconTrash2,
} from '@jirawatpyk/aura-react/icons';
import { cleanPhrase, phraseRefusal, type ForbiddenGroup } from '@dxt/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { FOCUS_TARGET } from '@/components/focus-target';
import { SECTION_HEADING } from '@/features/settings';
import { addPhrase, checkPhrase, removePhrase } from '../actions';
import {
  addedLine,
  checkWords,
  GROUP_OPTIONS,
  phraseGroups,
  REFUSAL_WORDS,
  removedLine,
  removeWords,
  type CheckWords,
  type Phrase,
} from '../phrases';

type Open = { kind: 'add' } | { kind: 'remove'; phrase: Phrase } | null;

/**
 * Shared forbidden words (board OrganisationLists, spec §41 items 4–8, D-069): groups collapsed with a
 * count — the phrases are offensive spam, shown only when an Admin opens a group. One phrase at a time
 * in a dialog with a required note; a new phrase is checked against the live sites' last clean fetch
 * before it can be added (and again by the SQL as it saves). Editing from md; view only below.
 */
export function ForbiddenSection({ phrases }: { phrases: Phrase[] | null }) {
  const router = useRouter();
  const [openGroup, setOpenGroup] = useState<ForbiddenGroup | null>(null);
  // As the holidays: the last dialog stays mounted (closed) so focus returns to its opener.
  const [last, setLast] = useState<Open>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [opened, setOpened] = useState(0);
  const [done, setDone] = useState<{ text: string; n: number } | null>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (done) statusRef.current?.focus();
  }, [done]);

  const show = (o: Exclude<Open, null>) => {
    setDone(null);
    setOpened((n) => n + 1);
    setLast(o);
    setIsOpen(true);
  };
  const finish = (text: string) => {
    setIsOpen(false);
    setDone((d) => ({ text, n: (d?.n ?? 0) + 1 }));
    router.refresh();
  };

  const groups = phrases ? phraseGroups(phrases) : [];
  return (
    <section
      id="forbidden"
      className="flex scroll-mt-18 lg:scroll-mt-4 flex-col gap-3"
      aria-labelledby="forbidden-h"
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="forbidden-h" className={SECTION_HEADING}>
            <span className="md:hidden">SHARED FORBIDDEN WORDS</span>
            <span className="hidden md:inline">Shared forbidden words</span>
          </h2>
          <span className="text-sm text-fg-secondary">
            Every site is checked for these on top of its own “Must not contain”. A hit opens PROBLEM ·
            Keyword on that site.{phrases ? ` ${phrases.length} phrases.` : ''}
          </span>
        </div>
        {phrases && (
          <div className="hidden md:flex">
            <Button
              variant="secondary"
              size="sm"
              touchHeight
              icon={<IconPlus />}
              onClick={() => show({ kind: 'add' })}
            >
              Add phrase
            </Button>
          </div>
        )}
      </div>

      <span
        ref={statusRef}
        role="status"
        tabIndex={-1}
        className={`self-start text-sm text-fg-positive empty:hidden ${FOCUS_TARGET}`}
      >
        {done?.text}
      </span>

      {phrases ? (
        <div className="overflow-hidden rounded-aura-lg border border-border-default bg-bg-surface">
          {groups.map((g, i) => {
            const open = openGroup === g.id;
            return (
              <div key={g.id} className={i > 0 ? 'border-t border-border-subtle' : undefined}>
                <div className="flex min-h-13 items-center gap-3 py-1 pr-3 pl-4 md:pl-5">
                  <span className="grow font-semibold">{g.label}</span>
                  <span className="text-sm text-fg-secondary">{g.count}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    touchHeight
                    aria-expanded={open}
                    aria-controls={`phrases-${g.id}`}
                    aria-label={`${open ? 'Hide' : 'Show'} ${g.count} in ${g.label}`}
                    onClick={() => setOpenGroup(open ? null : g.id)}
                  >
                    {open ? 'Hide' : 'Show'}
                  </Button>
                </div>
                {open && (
                  <ul
                    id={`phrases-${g.id}`}
                    aria-label={`${g.label} phrases`}
                    className="m-0 flex list-none flex-wrap gap-2 px-4 pt-1 pb-4 md:px-5"
                  >
                    {g.phrases.map((p) => (
                      <li key={p.id} lang={p.lang}>
                        {/* Phones read them; removing is from md (§22.5). */}
                        <span className="md:hidden">
                          <Tag>{p.phrase}</Tag>
                        </span>
                        <span className="hidden md:inline">
                          <Tag
                            removeLabel={`Remove ${p.phrase} from ${g.label}`}
                            onRemove={() =>
                              show({ kind: 'remove', phrase: { id: p.id, group: g.id, phrase: p.phrase } })
                            }
                          >
                            {p.phrase}
                          </Tag>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <Alert tone="danger" title="Couldn’t load the list">
          Reload the page. Sites are still checked for the phrases as they were.
        </Alert>
      )}
      <span className="hidden text-xs text-fg-secondary md:inline">
        Collapsed by default — the phrases are offensive spam, so they show only when an Admin opens a group.
        Every add and remove needs a note and is logged.
      </span>
      <span className="flex items-center gap-2 text-xs text-fg-secondary md:hidden">
        <span className="flex" aria-hidden>
          <IconEye size="sm" />
        </span>
        Holidays and phrases change on a larger screen.
      </span>

      {last?.kind === 'add' && phrases && (
        <AddDialog
          key={opened}
          open={isOpen}
          phrases={phrases}
          onClose={() => setIsOpen(false)}
          onDone={finish}
        />
      )}
      {last?.kind === 'remove' && (
        <RemoveDialog
          key={opened}
          open={isOpen}
          phrase={last.phrase}
          onClose={() => setIsOpen(false)}
          onDone={finish}
        />
      )}
    </section>
  );
}

function Failure({ text }: { text: string | null }) {
  return text ? (
    <Alert tone="danger" title="Not saved" role="alert">
      {text}
    </Alert>
  ) : null;
}

function CheckBox({ words }: { words: CheckWords }) {
  if (words.kind === 'found') {
    return (
      <div className="flex flex-col gap-1.5 rounded-aura-md border border-alert-danger-border bg-alert-danger-bg px-3.5 py-3 text-sm leading-normal">
        <span className="flex gap-2 font-semibold text-alert-danger-fg">
          <span className="flex pt-0.5" aria-hidden>
            <IconBan size="sm" />
          </span>
          {words.title}
        </span>
        <span className="font-mono text-xs break-words text-fg-secondary">
          {words.snippet.before}
          <mark className="bg-alert-warning-bg text-fg-primary">{words.snippet.match}</mark>
          {words.snippet.after}
        </span>
        <span className="text-fg-secondary">{words.line}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 rounded-aura-md border border-alert-success-border bg-alert-success-bg px-3.5 py-3 text-sm leading-normal">
      <span className="flex gap-2 font-semibold text-alert-success-fg">
        <span className="flex pt-0.5" aria-hidden>
          <IconCircleCheck size="sm" />
        </span>
        {words.title}
      </span>
      {words.lines.map((l) => (
        <span key={l}>{l}</span>
      ))}
    </div>
  );
}

function AddDialog({
  open,
  phrases,
  onClose,
  onDone,
}: {
  open: boolean;
  phrases: Phrase[];
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [group, setGroup] = useState<ForbiddenGroup>('gambling_th');
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  // The check belongs to the phrase it was run on: editing the phrase asks for a new one.
  const [checked, setChecked] = useState<{ phrase: string; words: CheckWords } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const [saving, startSave] = useTransition();

  const phrase = cleanPhrase(text);
  const refusal = phraseRefusal(
    text,
    phrases.map((p) => p.phrase),
  );
  const shownRefusal = refusal === 'empty' ? (tried ? refusal : null) : refusal;
  const current = checked && checked.phrase === phrase ? checked.words : null;
  const found = current?.kind === 'found';
  const ready = current?.kind === 'clear';
  const n = note.trim();
  const noteError =
    ready && tried && !n ? 'Add a short note — it goes in the audit log with the change.' : null;
  const foot =
    !phrase || refusal
      ? ''
      : current
        ? found
          ? 'Not saved — change the phrase and check again.'
          : 'Checked · ready to add'
        : 'Checked against every live site before it’s saved.';

  const check = () => {
    setTried(true);
    if (refusal) return;
    setFailure(null);
    startCheck(async () => {
      const r = await checkPhrase(phrase);
      if (r.ok) setChecked({ phrase, words: checkWords(r.check, phrase) });
      else setFailure(r.message);
    });
  };
  const save = () => {
    setTried(true);
    if (!n) return;
    setFailure(null);
    startSave(async () => {
      const r = await addPhrase({ group, phrase, note: n });
      if (r.ok) onDone(addedLine(phrase, group));
      else setFailure(r.message);
    });
  };
  const busy = checking || saving;

  return (
    <Dialog
      open={open}
      size="md"
      onClose={() => !busy && onClose()}
      title="Add a forbidden phrase"
      description="Every site is checked for it on top of its own “Must not contain”."
      footer={
        <>
          <span className="grow text-xs text-fg-secondary">{foot}</span>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={ready ? <IconPlus /> : <IconSearch />}
            loading={busy}
            disabled={!!refusal || found}
            onClick={ready ? save : check}
          >
            {ready ? 'Add and log' : 'Check phrase'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Select
          touchHeight
          label="Group"
          options={GROUP_OPTIONS}
          value={group}
          onChange={(e) => {
            const g = GROUP_OPTIONS.find((o) => o.value === e.target.value);
            if (g) setGroup(g.value);
          }}
        />
        <TextField
          touchHeight
          label="Phrase"
          required
          value={text}
          onChange={(e) => setText(e.target.value)}
          error={shownRefusal ? REFUSAL_WORDS[shownRefusal] : undefined}
          hint="A phrase, not a single short word. Case and spacing don’t matter."
        />
        {checking && (
          <span role="status" className="flex items-center gap-2 text-sm text-fg-secondary">
            <span className="flex animate-spin" aria-hidden>
              <IconLoaderCircle size="sm" />
            </span>
            Checking the live sites’ last clean fetch…
          </span>
        )}
        {current && !checking && <CheckBox words={current} />}
        <Textarea
          label="Change note"
          required
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          error={noteError ?? undefined}
          placeholder="Why add it? e.g. seen on a client site this week"
          hint="Saved with the change in the audit log."
        />
        <Failure text={failure} />
      </div>
    </Dialog>
  );
}

function RemoveDialog({
  open,
  phrase,
  onClose,
  onDone,
}: {
  open: boolean;
  phrase: Phrase;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const words = removeWords(phrase.group);
  const n = note.trim();
  const remove = () => {
    setTried(true);
    if (!n) return;
    setFailure(null);
    start(async () => {
      const r = await removePhrase({ id: phrase.id, note: n });
      if (r.ok) onDone(removedLine(phrase.phrase, phrase.group));
      else setFailure(r.message);
    });
  };
  return (
    <Dialog
      open={open}
      size="sm"
      onClose={() => !pending && onClose()}
      title={`Remove “${phrase.phrase}”?`}
      description={words.description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" icon={<IconTrash2 />} loading={pending} onClick={remove}>
            Remove and log
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <span className="text-sm leading-normal text-fg-secondary">{words.body}</span>
        <Textarea
          label="Change note"
          required
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          error={tried && !n ? 'Add a short note — it goes in the audit log with the change.' : undefined}
          placeholder="Why remove it?"
          hint="Saved with the change in the audit log."
        />
        <Failure text={failure} />
      </div>
    </Dialog>
  );
}
