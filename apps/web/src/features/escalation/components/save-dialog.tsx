import { Alert, Button, Dialog, Textarea } from '@jirawatpyk/aura-react';
import { IconCheck, IconCircleAlert, IconInfo, IconTriangleAlert } from '@jirawatpyk/aura-react/icons';
import type { DiffRow } from '../model';

/**
 * "Save escalation changes?" (Escalation board): the blocking problems, the warnings, the diff, who it
 * affects, a required note, "Save and log".
 */
export function SaveDialog({
  problems,
  warnings,
  rows,
  affects,
  note,
  noteError,
  failure,
  pending,
  onNote,
  onSave,
  onClose,
}: {
  problems: readonly string[];
  warnings: readonly string[];
  rows: readonly DiffRow[];
  affects: string;
  note: string;
  noteError: string | null;
  failure: string | null;
  pending: boolean;
  onNote: (v: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      title="Save escalation changes?"
      description="Check each step before it goes live. New incidents use the new policy straight away."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Back to editing
          </Button>
          <Button
            variant="primary"
            icon={<IconCheck />}
            disabled={problems.length > 0}
            loading={pending}
            onClick={onSave}
          >
            Save and log
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        {problems.length > 0 && (
          <div
            role="alert"
            className="flex flex-col gap-1.5 rounded-aura-md border border-fg-danger px-3.5 py-3 text-sm"
          >
            <span className="flex items-center gap-2 font-semibold text-fg-danger">
              <IconCircleAlert size="sm" aria-hidden />
              {problems.length === 1
                ? 'Fix 1 problem before saving'
                : `Fix ${problems.length} problems before saving`}
            </span>
            {problems.map((p) => (
              <span key={p} className="pl-6">
                {p}
              </span>
            ))}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-aura-md border border-border-strong px-3.5 py-3 text-sm">
            <span className="flex items-center gap-2 font-semibold text-fg-warning">
              <IconTriangleAlert size="sm" aria-hidden />
              Allowed, but check
            </span>
            {warnings.map((w) => (
              <span key={w} className="pl-6">
                {w}
              </span>
            ))}
          </div>
        )}
        <dl className="m-0 flex flex-col rounded-aura-md border border-border-default">
          {rows.map((r, i) => (
            <div
              key={r.where}
              className={`grid grid-cols-[calc(var(--spacing)*31)_minmax(0,1fr)] gap-3 px-3.5 py-2.5 text-sm ${i ? 'border-t border-border-subtle' : ''}`}
            >
              <dt className="font-mono text-xs whitespace-nowrap text-fg-secondary">{r.where}</dt>
              <dd className="m-0 flex flex-col gap-0.5">
                {r.before && (
                  <del className="text-fg-danger">
                    <span className="sr-only">Was: </span>
                    {r.before}
                  </del>
                )}
                {r.after && (
                  <ins className="text-fg-positive no-underline">
                    <span className="sr-only">Now: </span>
                    {r.after}
                  </ins>
                )}
              </dd>
            </div>
          ))}
        </dl>
        <p className="m-0 flex items-center gap-2.5 rounded-aura-md bg-bg-canvas px-3.5 py-2.5 text-sm">
          <IconInfo size="sm" aria-hidden className="text-fg-secondary" />
          {affects}
        </p>
        <Textarea
          label="Change note"
          required
          rows={2}
          placeholder="Why are you changing this?"
          value={note}
          onChange={(e) => onNote(e.target.value)}
          error={noteError ?? undefined}
          hint="Saved with the change in the audit log."
        />
        {failure && (
          <Alert tone="danger" title="Not saved">
            {failure}
          </Alert>
        )}
      </div>
    </Dialog>
  );
}
