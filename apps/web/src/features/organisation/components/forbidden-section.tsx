'use client';

import { Alert, Button, Dialog, Select, Tag, Textarea, TextField } from '@jirawatpyk/aura-react';
import {
  IconBan,
  IconCircleCheck,
  IconEye,
  IconEyeOff,
  IconLoaderCircle,
  IconPlus,
  IconSearch,
  IconTrash2,
  IconTriangleAlert,
} from '@jirawatpyk/aura-react/icons';
import { cleanPhrase, phraseRefusal, type ForbiddenGroup } from '@dxt/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { FOCUS_TARGET } from '@/components/focus-target';
import { SECTION_HEADING } from '@/features/settings';
import { addPhrase, checkPhrase, removePhrase } from '../actions';
import {
  addedLine,
  checkFoot,
  checkingLine,
  checkWords,
  GROUP_OPTIONS,
  MAX_PHRASES,
  phraseGroups,
  phraseLang,
  REFUSAL_WORDS,
  removedLine,
  removeWords,
  type CheckWords,
  type Phrase,
} from '../phrases';

type Open = { kind: 'add' } | { kind: 'remove'; phrase: Phrase } | null;

/** Keeps a count with its word when the line wraps ("36 phrases"). */
const NBSP = String.fromCharCode(160);
const NOTE_WORDS = 'Add a short note — it goes in the audit log with the change.';

/**
 * Shared forbidden words (board OrganisationLists, spec §41 items 4–8, D-069): groups collapsed with a
 * count — the phrases are offensive spam, shown only when an Admin opens a group. One phrase at a time
 * in a dialog with a required note; a new phrase is checked against the live sites' last clean fetch
 * before it can be added (and again by the SQL as it saves). Editing from md; view only below.
 */
export function ForbiddenSection({ phrases, liveSites }: { phrases: Phrase[] | null; liveSites: number }) {
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
  const finish = (text: string, group: ForbiddenGroup) => {
    setIsOpen(false);
    // The group the change was in stays open, so the new chip shows (board: Saved · toast).
    setOpenGroup(group);
    setDone((d) => ({ text, n: (d?.n ?? 0) + 1 }));
    router.refresh();
  };

  const groups = phrases ? phraseGroups(phrases) : [];
  const full = (phrases?.length ?? 0) >= MAX_PHRASES;
  return (
    <section
      id="forbidden"
      className="flex scroll-mt-18 lg:scroll-mt-4 flex-col gap-3"
      aria-labelledby="forbidden-h"
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="forbidden-h" className={SECTION_HEADING}>
            <span className="md:hidden">SHARED FORBIDDEN WORDS{phrases ? ` · ${phrases.length}` : ''}</span>
            <span className="hidden md:inline">Shared forbidden words</span>
          </h2>
          <span className="hidden text-sm text-fg-secondary md:inline">
            Every site is checked for these on top of its own “Must not contain”. A hit opens PROBLEM ·
            Keyword on that site.{phrases ? ` ${phrases.length}${NBSP}phrases.` : ''}
          </span>
          <span className="text-sm text-fg-secondary md:hidden">
            Checked on every site on top of its own list. Groups stay closed until you open one.
          </span>
        </div>
        {phrases && (
          <div className="hidden flex-col items-end gap-1 md:flex">
            <Button
              variant="secondary"
              size="sm"
              touchHeight
              icon={<IconPlus />}
              disabled={full}
              onClick={() => show({ kind: 'add' })}
            >
              Add phrase
            </Button>
            {full && (
              <span className="text-xs text-fg-secondary">
                The list holds {MAX_PHRASES} phrases — remove one first.
              </span>
            )}
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
            const lone = g.phrases.length === 1;
            return (
              <div key={g.id} className={i > 0 ? 'border-t border-border-subtle' : undefined}>
                <div className="flex min-h-13 items-center gap-3 py-1 pr-3 pl-4 md:pl-5">
                  <h3 className="m-0 grow text-base font-semibold">{g.label}</h3>
                  <span className="text-sm text-fg-secondary">{g.count}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    touchHeight
                    icon={open ? <IconEyeOff /> : <IconEye />}
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
                      <li key={p.id}>
                        {/* Phones read them; removing is from md (§22.5). A group keeps its last phrase. */}
                        <span className={lone ? undefined : 'md:hidden'}>
                          <Tag>
                            <span lang={p.lang}>{p.phrase}</span>
                          </Tag>
                        </span>
                        {!lone && (
                          <span className="hidden md:inline">
                            <Tag
                              removeLabel={`Remove ${p.phrase} from ${g.label}`}
                              onRemove={() =>
                                show({ kind: 'remove', phrase: { id: p.id, group: g.id, phrase: p.phrase } })
                              }
                            >
                              <span lang={p.lang}>{p.phrase}</span>
                            </Tag>
                          </span>
                        )}
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
        Every add and remove needs a note and is logged. A group keeps at least one phrase.
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
          liveSites={liveSites}
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

function Failure({ text, title = 'Not saved' }: { text: string | null; title?: string }) {
  return text ? (
    <Alert tone="danger" title={title} role="alert">
      {text}
    </Alert>
  ) : null;
}

const BOX = {
  found: {
    box: 'border-alert-danger-border bg-alert-danger-bg',
    head: 'text-alert-danger-fg',
    icon: <IconBan size="sm" />,
  },
  clear: {
    box: 'border-alert-success-border bg-alert-success-bg',
    head: 'text-alert-success-fg',
    icon: <IconCircleCheck size="sm" />,
  },
  partial: {
    box: 'border-alert-warning-border bg-alert-warning-bg',
    head: 'text-alert-warning-fg',
    icon: <IconTriangleAlert size="sm" />,
  },
} as const;

function CheckBox({ words, phrase }: { words: CheckWords; phrase: string }) {
  const look = BOX[words.kind];
  return (
    <div
      className={`flex flex-col gap-1.5 rounded-aura-md border px-3.5 py-3 text-sm leading-normal ${look.box}`}
    >
      <span className={`flex gap-2 font-semibold ${look.head}`}>
        <span className="flex pt-0.5" aria-hidden>
          {look.icon}
        </span>
        {words.title}
      </span>
      {words.kind === 'found' ? (
        <>
          <span className="font-mono text-xs break-words text-fg-secondary">
            {words.snippet.before}
            <mark className="bg-alert-warning-bg text-fg-primary" lang={phraseLang(phrase)}>
              {words.snippet.match}
            </mark>
            {words.snippet.after}
          </span>
          <span className="text-fg-secondary">{words.line}</span>
        </>
      ) : (
        words.lines.map((l) => <span key={l}>{l}</span>)
      )}
    </div>
  );
}

function AddDialog({
  open,
  phrases,
  liveSites,
  onClose,
  onDone,
}: {
  open: boolean;
  phrases: Phrase[];
  liveSites: number;
  onClose: () => void;
  onDone: (text: string, group: ForbiddenGroup) => void;
}) {
  const [group, setGroup] = useState<ForbiddenGroup>('gambling_th');
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [triedSave, setTriedSave] = useState(false);
  // The check belongs to the phrase it was run on: editing the phrase asks for a new one.
  const [checked, setChecked] = useState<{ phrase: string; words: CheckWords } | null>(null);
  const [failure, setFailure] = useState<{ title: string; text: string } | null>(null);
  const [checking, startCheck] = useTransition();
  const [saving, startSave] = useTransition();
  const resultRef = useRef<HTMLDivElement>(null);

  const phrase = cleanPhrase(text);
  const refusal = phraseRefusal(
    text,
    phrases.map((p) => p.phrase),
  );
  const shownRefusal = refusal === 'empty' ? null : refusal;
  const current = checked && checked.phrase === phrase ? checked.words : null;
  const found = current?.kind === 'found';
  const ready = current !== null && !found;
  const n = note.trim();
  // A result moves focus to itself: the button that was pressed may now be disabled (found).
  useEffect(() => {
    if (checked) resultRef.current?.focus();
  }, [checked]);

  const check = () => {
    if (refusal) return;
    setFailure(null);
    startCheck(async () => {
      const r = await checkPhrase(phrase);
      if (r.ok) setChecked({ phrase, words: checkWords(r.check, phrase) });
      else setFailure({ title: 'Not checked', text: r.message });
    });
  };
  const save = () => {
    setTriedSave(true);
    if (!n) return;
    setFailure(null);
    startSave(async () => {
      const r = await addPhrase({ group, phrase, note: n });
      if (r.ok) return onDone(addedLine(phrase, group), group);
      // Refused at save (the SQL checks again): back to Check phrase, so the dialog never says both.
      setChecked(null);
      setFailure({ title: 'Not saved', text: r.message });
    });
  };
  const busy = checking || saving;

  return (
    <Dialog
      open={open}
      size="md"
      dismissOnScrim={false}
      onClose={() => !busy && onClose()}
      title="Add a forbidden phrase"
      description="Every site is checked for it on top of its own “Must not contain”."
      footer={
        <>
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
        {/* One live region, always mounted: the checking line, then the result (spec-checker). */}
        <div ref={resultRef} tabIndex={-1} aria-live="polite" className={`flex flex-col ${FOCUS_TARGET}`}>
          {checking ? (
            <span className="flex items-center gap-2 text-sm text-fg-secondary">
              <span className="flex motion-safe:animate-spin" aria-hidden>
                <IconLoaderCircle size="sm" />
              </span>
              {checkingLine(liveSites)}
            </span>
          ) : (
            current && <CheckBox words={current} phrase={phrase} />
          )}
        </div>
        <Textarea
          label="Change note"
          required
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          error={ready && triedSave && !n ? NOTE_WORDS : undefined}
          placeholder="Why add it? e.g. seen on a client site this week"
          hint="Saved with the change in the audit log."
        />
        {/* The board's footer line; above the buttons, which keep one row at every width. */}
        {phrase && !refusal && <span className="text-xs text-fg-secondary">{checkFoot(current)}</span>}
        <Failure text={failure?.text ?? null} title={failure?.title} />
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
  onDone: (text: string, group: ForbiddenGroup) => void;
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
      if (r.ok) onDone(removedLine(phrase.phrase, phrase.group), phrase.group);
      else setFailure(r.message);
    });
  };
  return (
    <Dialog
      open={open}
      size="sm"
      role="alertdialog"
      dismissOnScrim={false}
      onClose={() => !pending && onClose()}
      title={
        <>
          Remove “<span lang={phraseLang(phrase.phrase)}>{phrase.phrase}</span>”?
        </>
      }
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
          error={tried && !n ? NOTE_WORDS : undefined}
          placeholder="Why remove it?"
          hint="Saved with the change in the audit log."
        />
        <Failure text={failure} />
      </div>
    </Dialog>
  );
}
