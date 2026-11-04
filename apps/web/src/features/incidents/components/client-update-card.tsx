'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  IconButton,
  SegmentedControl,
  Textarea,
  toast,
} from '@jirawatpyk/aura-react';
import { IconCheck, IconCircleCheck, IconClock, IconCopy, IconUsers } from '@jirawatpyk/aura-react/icons';
import { formatTier, formatTime } from '@dxt/shared';
import { markClientUpdate } from '../actions';
import type { ClientUpdateCard as Card_ } from '../model';

const FAILED = 'Couldn’t reach the server. Check your connection and try again.';
const LANGS = [
  { value: 'th', label: 'TH' },
  { value: 'en', label: 'EN' },
];

/**
 * The Client update card (Incident / MIncident boards, spec §9, §14.11, §16.2, D-052): the AM, the due
 * time, the state, the TH / EN draft with Copy, and — for whoever §16.6 lets — Mark client updated (an
 * optional note) and Not needed… (a reason). Marking sends nothing, so there is no Undo.
 */
export function ClientUpdateCard({
  card: c,
  incidentId,
  incidentLabel,
  siteName,
  tier,
  acked,
  phone,
}: {
  card: Card_;
  incidentId: string;
  incidentLabel: string;
  siteName: string;
  tier: number;
  /** One primary per view (§13): Mark is the primary once the incident is acknowledged. */
  acked: boolean;
  phone: boolean;
}) {
  const [lang, setLang] = useState<'th' | 'en'>(c.lang);
  const [copied, setCopied] = useState(false);
  // The dialog stays mounted so AURA can return focus on close; a fresh form each time it opens.
  const [dialog, setDialog] = useState<{ open: boolean; kind: 'mark' | 'not_needed'; key: number }>({
    open: false,
    kind: 'mark',
    key: 0,
  });
  const openDialog = (kind: 'mark' | 'not_needed') =>
    setDialog((d) => ({ open: true, kind, key: d.key + 1 }));
  const cardRef = useRef<HTMLDivElement>(null);
  // "Open draft" (Chat, email) links to #client-update: the card drawn twice (desktop column, phone
  // stack), so the one showing scrolls itself into view.
  useEffect(() => {
    const el = cardRef.current;
    if (window.location.hash === '#client-update' && el && el.getClientRects().length > 0) {
      el.scrollIntoView({ block: 'start' });
    }
  }, []);
  const due = formatTime(new Date(c.dueAt));
  const pending = c.status === 'pending';
  const draft = c.drafts[lang];
  const copyFailed = () =>
    toast.error('Couldn’t copy the draft', { description: 'Select the text and copy it.' });
  const copy = () => {
    if (!navigator.clipboard) return copyFailed();
    void navigator.clipboard
      .writeText(draft)
      .then(() => setCopied(true))
      .catch(copyFailed);
  };
  // M4: after a mark the buttons are gone; focus moves to the recorded state, which is announced.
  const doneRef = useRef<HTMLDivElement>(null);
  const justMarked = useRef(false);
  useEffect(() => {
    if (justMarked.current && c.status !== 'pending') {
      justMarked.current = false;
      doneRef.current?.focus();
    }
  }, [c.status]);
  const notified = `${formatTime(new Date(c.notifiedAt))}${c.byHand ? ' (by hand)' : ''}`;

  return (
    <div ref={cardRef} className="scroll-mt-4">
      <Card
        title="Client update"
        headingLevel={2}
        actions={
          pending ? (
            <Badge tone="warning" variant="outline" icon={<IconClock />}>{`Due ${due}`}</Badge>
          ) : (
            <Badge tone="success" variant="outline" icon={<IconCircleCheck />}>
              {c.status === 'not_needed' ? 'Not needed' : 'Updated'}
            </Badge>
          )
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <span className="flex items-center gap-2.5">
            {c.am ? (
              <Avatar name={c.am} size="sm" />
            ) : (
              <span className="flex text-fg-secondary">
                <IconUsers size="sm" aria-hidden />
              </span>
            )}
            <span className="grow">
              <b className="font-medium">{c.am ?? 'No account manager'}</b>
              {c.am ? ' · Account manager' : ' · the Admins were told'}
            </span>
            <span className="text-fg-secondary">{phone ? `Due ${due}` : `Notified ${notified}`}</span>
          </span>
          {!phone && (
            <>
              <span className="flex justify-between gap-2">
                <span className="text-fg-secondary">Due</span>
                <span>{c.dueLine}</span>
              </span>
              <div
                ref={phone ? undefined : doneRef}
                tabIndex={-1}
                role="status"
                className="flex justify-between gap-3 outline-none"
              >
                <span className="shrink-0 text-fg-secondary">State</span>
                <span
                  className={`text-right font-medium ${pending ? 'text-fg-warning' : c.status === 'not_needed' ? 'text-fg-secondary' : 'text-fg-positive'}`}
                >
                  {c.stateText}
                </span>
              </div>
              {c.note && (
                <span className="flex justify-between gap-3">
                  <span className="shrink-0 text-fg-secondary">{c.note.label}</span>
                  <span className="text-right">{c.note.text}</span>
                </span>
              )}
            </>
          )}
          {phone && (
            <div ref={doneRef} tabIndex={-1} role="status" className="outline-none">
              {c.markedLine && (
                <Alert tone="success" icon={<IconCircleCheck />}>
                  <b className="font-semibold">{c.markedLine}</b>
                  {c.note ? ` — ${c.note.text}` : ''}
                </Alert>
              )}
            </div>
          )}
          <span className="flex items-center justify-between gap-2">
            <span className="text-xs text-fg-secondary">
              {phone
                ? `Draft ${c.am ?? 'the Admins'} ${c.am ? 'was' : 'were'} sent at ${notified}`
                : `Draft for ${c.client}`}
            </span>
            <span className="flex items-center gap-1">
              {!phone && (
                <IconButton
                  icon={copied ? <IconCheck /> : <IconCopy />}
                  label={copied ? 'Draft copied' : 'Copy draft'}
                  size="sm"
                  onClick={copy}
                />
              )}
              <SegmentedControl
                label="Draft language"
                size="sm"
                touchHeight={phone}
                value={lang}
                onChange={(v) => {
                  setLang(v as 'th' | 'en');
                  setCopied(false);
                }}
                options={LANGS}
              />
            </span>
          </span>
          <div className="whitespace-pre-line rounded-aura-sm border border-border-default bg-bg-canvas px-3.5 py-3 leading-relaxed">
            {draft}
          </div>
          {phone && (
            <Button variant="secondary" icon={copied ? <IconCheck /> : <IconCopy />} fullWidth onClick={copy}>
              {copied ? 'Draft copied' : 'Copy draft'}
            </Button>
          )}
          {pending && c.canMark && (
            <span className="flex flex-wrap items-center gap-2">
              <Button
                variant={acked && !phone ? 'primary' : 'secondary'}
                icon={<IconCheck />}
                size={phone ? undefined : 'sm'}
                fullWidth={phone}
                onClick={() => openDialog('mark')}
              >
                Mark client updated
              </Button>
              <Button
                variant="ghost"
                size={phone ? undefined : 'sm'}
                fullWidth={phone}
                onClick={() => openDialog('not_needed')}
              >
                Not needed…
              </Button>
            </span>
          )}
          <span className="text-xs text-fg-secondary">
            {pending && !c.canMark
              ? `${c.am ? `${c.am}, the site’s owner or an Admin` : 'The site’s owner or an Admin'} marks it. ${c.foot}`
              : c.foot}
          </span>
          <span role="status" className="sr-only">
            {copied ? 'Draft copied' : ''}
          </span>
        </div>
        {c.canMark && pending && (
          <MarkDialog
            key={dialog.key}
            open={dialog.open}
            kind={dialog.kind}
            incidentId={incidentId}
            description={`${incidentLabel} · ${siteName} · ${formatTier(tier)} · ${c.am ? `AM ${c.am}` : 'no AM'} · due ${due}`}
            onClose={() => setDialog((d) => ({ ...d, open: false }))}
            onSaved={() => {
              justMarked.current = true;
            }}
          />
        )}
      </Card>
    </div>
  );
}

/** Mark client updated (optional note, D-052 item 1) and Not needed (reason required), one form. */
function MarkDialog({
  open,
  kind,
  incidentId,
  description,
  onClose,
  onSaved,
}: {
  open: boolean;
  kind: 'mark' | 'not_needed';
  incidentId: string;
  description: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const notNeeded = kind === 'not_needed';
  const empty = !note.trim();
  const submit = () =>
    start(async () => {
      setError(null);
      const r = await markClientUpdate({ incidentId, notNeeded, note }).catch(() => ({
        ok: false as const,
        message: FAILED,
      }));
      if (!r.ok) {
        setError(r.message);
        return;
      }
      onSaved();
      onClose();
      router.refresh();
    });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={notNeeded ? 'Client update not needed' : 'Mark client updated'}
      description={description}
      footer={
        <>
          <span className="mr-auto text-xs text-fg-secondary">
            {notNeeded
              ? empty
                ? 'A reason is required before you can save.'
                : 'Unlocks the client-update condition for Resolve.'
              : 'Unlocks the client-update condition for Resolve.'}
          </span>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={notNeeded && empty} loading={saving} onClick={submit}>
            {notNeeded ? 'Mark not needed' : 'Mark updated'}
          </Button>
        </>
      }
    >
      <Textarea
        label={notNeeded ? 'Reason' : 'Note'}
        required={notNeeded}
        optional={!notNeeded}
        rows={3}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={
          notNeeded
            ? 'e.g. The client reported it to us first and is on the call'
            : 'e.g. Called the client’s ops, ETA shared'
        }
        hint={
          notNeeded
            ? 'Required. Recorded in the audit log and shown as “Client notified: not needed” in the post-incident review.'
            : 'Optional. Recorded in the audit log and the post-incident review (Client notified).'
        }
        error={error ?? undefined}
      />
    </Dialog>
  );
}
