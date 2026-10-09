'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Dialog, Select, Textarea, TextField, type DialogProps } from '@jirawatpyk/aura-react';
import {
  IconCircle,
  IconCircleCheck,
  IconClock,
  IconPencil,
  IconRotateCcw,
} from '@jirawatpyk/aura-react/icons';
import { canResolve, UNKNOWN_ROOT_CAUSE } from '@dxt/engine';
import { formatTime, formatTimeWithSeconds, ROOT_CAUSE_CATEGORIES, ROOT_CAUSE_LABELS } from '@dxt/shared';
import { useSecondsLeft } from '@/components/use-seconds-left';
import { addNote, resolveIncident, saveRootCause, undoResolve } from '../actions';
import type { Condition } from '../model';
import { rootCauseSchema } from '../schemas';

const CATEGORY_OPTIONS = ROOT_CAUSE_CATEGORIES.map((c) => ({ value: c, label: ROOT_CAUSE_LABELS[c] }));
const FAILED = 'Couldn’t reach the server. Check your connection and try again.';

export interface RootCauseValue {
  category: string;
  what: string;
  fix: string;
}

type Field = 'category' | 'what' | 'fix';

/** The root-cause fields (Incident "Root cause" dialog and Resolve, D-033): one form, both places. */
function RootCauseFields({
  value,
  onChange,
  errors,
  stillDown,
}: {
  value: RootCauseValue;
  onChange: (v: RootCauseValue) => void;
  errors: Partial<Record<Field, string>>;
  stillDown: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Select
        label="Root cause category"
        required
        placeholder="Choose one"
        options={CATEGORY_OPTIONS}
        value={value.category}
        onChange={(e) => onChange({ ...value, category: e.target.value })}
        error={errors.category}
        hint={
          value.category === UNKNOWN_ROOT_CAUSE
            ? 'Unknown keeps the incident open — it doesn’t meet the root-cause condition.'
            : undefined
        }
      />
      <Textarea
        label="What happened"
        required
        rows={3}
        value={value.what}
        onChange={(e) => onChange({ ...value, what: e.target.value })}
        error={errors.what}
        hint="Plain language — this text goes into the weekly summary and the client report."
      />
      <TextField
        label="What fixed it"
        optional
        value={value.fix}
        onChange={(e) => onChange({ ...value, fix: e.target.value })}
        error={errors.fix}
        placeholder={stillDown ? 'Leave empty while it’s still down' : 'e.g. Host restarted the app server'}
      />
    </div>
  );
}

/** Checks the form with the action's own schema, so the field says it before a round trip. */
function check(v: RootCauseValue): Partial<Record<Field, string>> {
  const r = rootCauseSchema.safeParse({ incidentId: '00000000-0000-4000-8000-000000000000', ...v });
  if (r.success) return {};
  const out: Partial<Record<Field, string>> = {};
  for (const issue of r.error.issues) {
    const f = issue.path[0];
    if ((f === 'category' || f === 'what' || f === 'fix') && !out[f]) out[f] = issue.message;
  }
  return out;
}

export interface DialogIncident {
  incidentId: string;
  /** "INC-0139 · ORCA Thailand · Tier 2 · owner Tao" */
  description: string;
  stillDown: boolean;
}

// ── Add note ─────────────────────────────────────────────────────────────

export function AddNoteDialog({
  incident,
  incidentLabel,
  siteName,
  viewerName,
  open,
  onClose,
}: {
  incident: DialogIncident;
  incidentLabel: string;
  siteName: string;
  viewerName: string;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      setError(null);
      const r = await addNote({ incidentId: incident.incidentId, text }).catch(() => ({
        ok: false as const,
        message: FAILED,
      }));
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setText('');
      onClose();
      router.refresh();
    });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a note"
      description={`${incidentLabel} · added to the timeline and posted in the Chat thread as “NOTE · ${siteName} · ${viewerName}: …” — no @mention, no email.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!text.trim()} loading={pending} onClick={submit}>
            Post note
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Textarea
          label="Your note"
          required
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Host says the app server is restarting"
          error={error ?? undefined}
        />
      </div>
    </Dialog>
  );
}

// ── Root cause (Save, keep open) ─────────────────────────────────────────

export function RootCauseDialog({
  incident,
  initial,
  open,
  onClose,
}: {
  incident: DialogIncident;
  initial: RootCauseValue;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = () => {
    const found = check(value);
    setErrors(found);
    if (Object.keys(found).length) return;
    start(async () => {
      setFailure(null);
      const r = await saveRootCause({ incidentId: incident.incidentId, ...value }).catch(() => ({
        ok: false as const,
        message: FAILED,
        field: undefined,
      }));
      if (!r.ok) {
        if (r.field) setErrors({ [r.field]: r.message });
        else setFailure(r.message);
        return;
      }
      onClose();
      router.refresh();
    });
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      title="Root cause"
      description={incident.description}
      footer={
        <>
          <span className="mr-auto text-xs text-fg-secondary">
            {value.category === UNKNOWN_ROOT_CAUSE
              ? 'Saves your notes · Unknown keeps the incident open — it doesn’t meet the root-cause condition.'
              : 'Saving records it on the timeline. Resolve unlocks when all 3 conditions are met.'}
          </span>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={<IconPencil />} loading={pending} onClick={submit}>
            Save, keep open
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {failure && (
          <Alert tone="danger" role="alert">
            {failure}
          </Alert>
        )}
        <RootCauseFields value={value} onChange={setValue} errors={errors} stillDown={incident.stillDown} />
      </div>
    </Dialog>
  );
}

// ── Resolve (Resolve board) ──────────────────────────────────────────────

type ResolveDone =
  { kind: 'resolved'; at: Date; postsAt: string; category: string } | { kind: 'kept'; at: Date };

const CondIcon = ({ met }: { met: boolean }) =>
  met ? (
    <span className="flex text-fg-positive" role="img" aria-label="Met">
      <IconCircleCheck className="size-4" />
    </span>
  ) : (
    <span className="flex text-fg-tertiary" role="img" aria-label="Not met">
      <IconCircle className="size-4" />
    </span>
  );

export function ConditionList({ conditions }: { conditions: Condition[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {conditions.map((c) => (
        <li key={c.key} className="flex items-start gap-2 text-sm leading-snug">
          <span className="pt-0.5">
            <CondIcon met={c.met} />
          </span>
          <span className="flex flex-col">
            <span className="font-medium">{c.label}</span>
            <span className="text-xs text-fg-secondary">{c.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ResolveDialog({
  incident,
  initial,
  conditions,
  summary,
  lasted,
  postedAt,
  viewerName,
  open,
  onClose,
  returnFocus,
  onUndone,
}: {
  incident: DialogIncident;
  initial: RootCauseValue;
  /** The page's conditions; the root-cause line follows the form here. */
  conditions: Condition[];
  /** "Down 8 min · Window Thu 22:14–22:22 · OK since 22:22" cells. */
  summary: { label: string; value: string }[];
  /** "Down 8 min" / "Problem lasted 12 min" for the outcome sentence (Resolve board). */
  lasted?: string;
  /** When the RESOLVED messages went out, once the page knows (after a refresh). */
  postedAt?: string | null;
  viewerName: string;
  open: boolean;
  onClose: () => void;
  /** Where focus goes when it closes, Undo included (WCAG 2.4.3): the page's Resolve button. */
  returnFocus?: DialogProps['finalFocus'];
  /** After an Undo: the page brings focus back to Resolve once it renders it again. */
  onUndone?: () => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<ResolveDone | null>(null);
  const [pending, start] = useTransition();
  const doneTitle = useRef<HTMLParagraphElement>(null);
  const seconds = useSecondsLeft(done?.kind === 'resolved' ? done.postsAt : null);
  // The button pressed is gone once the dialog shows the outcome: focus its first line (WCAG 2.4.3).
  useEffect(() => {
    if (done) doneTitle.current?.focus();
  }, [done]);

  const unknown = value.category === UNKNOWN_ROOT_CAUSE;
  const filled = !!value.category && !!value.what.trim();
  const live: Condition[] = conditions.map((c) =>
    c.key !== 'root_cause'
      ? c
      : {
          ...c,
          met: filled && !unknown,
          detail: unknown
            ? 'Unknown keeps the incident open'
            : filled
              ? 'Filled in below'
              : 'Fill in below · “Unknown — keep investigating” doesn’t count',
        },
  );
  const gate = canResolve({
    okRounds: conditions.find((c) => c.key === 'recovery')?.met ? 2 : 0,
    clientUpdate: conditions.find((c) => c.key === 'client_update')?.met ? 'not_required' : 'pending',
    rootCauseCategory: filled ? value.category : null,
  });

  const close = () => {
    setDone(null);
    setFailure(null);
    onClose();
  };

  const submit = () => {
    const found = check(value);
    setErrors(found);
    if (Object.keys(found).length) return;
    start(async () => {
      setFailure(null);
      if (unknown) {
        const r = await saveRootCause({ incidentId: incident.incidentId, ...value }).catch(() => ({
          ok: false as const,
          message: FAILED,
          field: undefined,
        }));
        if (!r.ok) return r.field ? setErrors({ [r.field]: r.message }) : setFailure(r.message);
        setDone({ kind: 'kept', at: new Date() });
      } else {
        const r = await resolveIncident({ incidentId: incident.incidentId, ...value }).catch(() => ({
          ok: false as const,
          message: FAILED,
          field: undefined,
        }));
        if (!r.ok) return r.field ? setErrors({ [r.field]: r.message }) : setFailure(r.message);
        setDone({ kind: 'resolved', at: new Date(), postsAt: r.postsAt, category: value.category });
      }
      router.refresh();
    });
  };

  const undo = () =>
    start(async () => {
      const r = await undoResolve(incident.incidentId).catch(() => ({ ok: false as const, message: FAILED }));
      if (!r.ok) {
        setFailure(r.message);
        return;
      }
      setDone(null);
      onClose();
      onUndone?.();
      router.refresh();
    });

  const label = (c: string) => ROOT_CAUSE_LABELS[c as keyof typeof ROOT_CAUSE_LABELS] ?? c;

  return (
    <Dialog
      open={open}
      onClose={close}
      size="md"
      title={
        done
          ? done.kind === 'resolved'
            ? 'Incident resolved'
            : 'Saved — incident still open'
          : 'Resolve incident'
      }
      description={incident.description}
      finalFocus={returnFocus}
      footer={
        done?.kind === 'resolved' ? (
          <>
            {seconds > 0 && (
              <Button variant="secondary" icon={<IconRotateCcw />} loading={pending} onClick={undo}>
                {`Undo · ${seconds} s`}
              </Button>
            )}
            <Button variant="primary" href="/incidents">
              Back to incidents
            </Button>
          </>
        ) : done?.kind === 'kept' ? (
          <>
            <Button variant="secondary" onClick={() => setDone(null)}>
              Edit again
            </Button>
            <Button variant="primary" href="/incidents">
              Back to incidents
            </Button>
          </>
        ) : (
          <>
            <span className={`mr-auto text-xs ${filled ? 'text-fg-secondary' : 'text-fg-warning'}`}>
              {!value.category
                ? 'Choose a root cause category'
                : !value.what.trim()
                  ? 'Write what happened to continue'
                  : unknown
                    ? 'Saves your notes · the incident stays open'
                    : gate.ok
                      ? 'All 3 conditions met'
                      : 'Resolve waits for every condition'}
            </span>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            {unknown ? (
              <Button
                variant="primary"
                icon={<IconPencil />}
                disabled={!filled}
                loading={pending}
                onClick={submit}
              >
                Save, keep open
              </Button>
            ) : (
              <Button
                variant="primary"
                icon={<IconCircleCheck />}
                disabled={!gate.ok}
                loading={pending}
                onClick={submit}
              >
                Resolve incident
              </Button>
            )}
          </>
        )
      }
    >
      {failure && (
        <Alert tone="danger" role="alert" className="mb-4">
          {failure}
        </Alert>
      )}
      {done?.kind === 'resolved' ? (
        <div className="flex flex-col gap-2">
          <p role="status" className="sr-only">
            {postedAt
              ? `Posted to Chat and email at ${formatTimeWithSeconds(new Date(postedAt))}`
              : 'Resolved. Posting to Chat and email in a few seconds — nothing is sent until then'}
          </p>
          <p
            ref={doneTitle}
            tabIndex={-1}
            className="m-0 rounded-aura-sm text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
          >
            {`Resolved at ${formatTime(done.at)} by ${viewerName}`}
          </p>
          <p className="m-0 text-sm text-fg-secondary">
            {`Root cause: ${label(done.category)}. ${lasted ? `${lasted}. ` : ''}`}
            {seconds > 0
              ? `Posting to Chat and email in ${seconds} s — nothing is sent until then`
              : postedAt
                ? `Posted to Chat and email at ${formatTimeWithSeconds(new Date(postedAt))}`
                : 'Posting to the Chat thread and email now'}
          </p>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
            {[
              ['Resolved reply to the Chat thread', 'Resolved reply posted in the Chat thread'],
              ['Resolved email to everyone emailed about it', 'Resolved email sent in the incident thread'],
            ].map(([held, sent]) => (
              <li key={held} className="flex items-start gap-2">
                <span
                  className={`flex pt-0.5 ${postedAt ? 'text-fg-positive' : 'text-fg-secondary'}`}
                  aria-hidden
                >
                  {postedAt ? <IconCircleCheck className="size-4" /> : <IconClock className="size-4" />}
                </span>
                <span className="grow">
                  {postedAt ? sent : seconds > 0 ? `${held} · held for undo` : `${held} · sending`}
                </span>
                <span className="shrink-0 font-mono text-xs text-fg-secondary tabular-nums">
                  {postedAt
                    ? formatTimeWithSeconds(new Date(postedAt))
                    : seconds > 0
                      ? `in ${seconds} s`
                      : 'now'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : done?.kind === 'kept' ? (
        <div className="flex flex-col gap-2">
          <p
            ref={doneTitle}
            tabIndex={-1}
            role="status"
            className="m-0 rounded-aura-sm text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
          >{`Saved at ${formatTime(done.at)} by ${viewerName} — still open`}</p>
          <p className="m-0 text-sm text-fg-secondary">
            It stays in “Needs root cause”. Notes are saved; pick a category when you know more.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {summary.length > 0 && (
            <dl className="m-0 grid grid-cols-3 gap-3 rounded-aura-md border border-border-default bg-bg-canvas p-aura-3">
              {summary.map((s) => (
                <div key={s.label} className="flex flex-col">
                  <dt className="text-xs text-fg-secondary">{s.label}</dt>
                  <dd className="m-0 text-sm font-medium tabular-nums">{s.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <section
            aria-labelledby="resolve-conditions-title"
            className="flex flex-col gap-2 rounded-aura-md border border-border-default p-aura-3"
          >
            <h3 id="resolve-conditions-title" className="m-0 text-sm font-semibold">
              Before you can resolve
            </h3>
            <ConditionList conditions={live} />
          </section>
          <RootCauseFields
            value={value}
            onChange={(v) => {
              setValue(v);
              setErrors({});
            }}
            errors={errors}
            stillDown={incident.stillDown}
          />
          {unknown && (
            <Alert tone="warning" title="Unknown keeps the incident open">
              It stays in “Needs root cause” until someone picks a real category. Your notes are saved.
            </Alert>
          )}
        </div>
      )}
    </Dialog>
  );
}
