'use client';

import { Alert, Button, Card, SegmentedControl, Select, TextField } from '@jirawatpyk/aura-react';
import { IconCircleAlert, IconClock, IconPlus, IconTriangleAlert } from '@jirawatpyk/aura-react/icons';
import type { EscalationStep } from '@dxt/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { UnsavedBar } from '@/components/unsaved-bar';
import { saveEscalation } from '../actions';
import {
  affectedPolicies,
  affectsLine,
  canAdd,
  diff,
  newStep,
  POLICY_LABELS,
  policyMessage,
  reminderError,
  saveProblems,
  saveWarnings,
  timerBasis,
  toSaveInput,
  unsavedSummary,
  type EscalationDraft,
  type PolicyKey,
} from '../model';
import { hoursLabel, hoursOf, scenario, sitesOf, tokenRows } from '../preview';
import type { EscalationPageData } from '../types';
import { useNow } from '../use-now';
import { SaveDialog } from './save-dialog';
import { StepDialog } from './step-dialog';
import { StepRow } from './step-row';

const draftOf = (d: EscalationPageData): EscalationDraft => ({
  policies: d.policies,
  downReminder: String(d.downReminder),
  problemReminder: String(d.problemReminder),
});

/**
 * The Escalation board for an Admin (S08, D-034): the policy switch, its ladder (L0 pinned, L1
 * editable), Preview, the reminder intervals, the sticky unsaved bar and the save dialog. Changes stay
 * on the page until "Save and log". When the control that had focus goes away (Delete, Add, Discard,
 * Save), focus moves to the ladder's heading (WCAG 2.4.3).
 */
export function EscalationEditor({ data, now }: { data: EscalationPageData; now: string }) {
  const router = useRouter();
  const saved = useMemo(() => draftOf(data), [data]);
  const [draft, setDraft] = useState(saved);
  const [key, setKey] = useState<PolicyKey>('t1');
  const [editing, setEditing] = useState<{ index: number; adding: boolean } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [pending, start] = useTransition();
  const [siteId, setSiteId] = useState<string | null>(null);
  const [refocus, setRefocus] = useState(0);
  const ladderHeading = useRef<HTMLHeadingElement>(null);
  const hours = useMemo(() => hoursOf(data.hours), [data.hours]);
  const clock = useNow(now);
  useEffect(() => {
    if (refocus) ladderHeading.current?.focus();
  }, [refocus]);

  const policy = draft.policies.find((p) => p.key === key) ?? draft.policies[0];
  if (!policy) throw new Error('No escalation policies — the S08 migration seeds four');
  const sites = sitesOf(policy, data.sites);
  const site = sites.find((s) => s.id === siteId) ?? sites[0];
  const reminderMin =
    Number(policy.severity === 'down' ? draft.downReminder : draft.problemReminder) || undefined;
  const preview = scenario(policy, site, data.admins, hours, clock, { reminderMin });
  const rows = diff(saved, draft);
  const summary = unsavedSummary(rows);
  const message = policyMessage(policy);
  const hoursText = hoursLabel(data.hours);

  const change = (next: (d: EscalationDraft) => EscalationDraft) => {
    setJustSaved(false);
    setDraft(next);
  };
  const setSteps = (steps: EscalationStep[]) =>
    change((d) => ({
      ...d,
      policies: d.policies.map((p) =>
        p.id === policy.id ? { ...p, steps: steps.map((s, level) => ({ ...s, level })) } : p,
      ),
    }));
  const editingPolicy = editing?.adding ? { ...policy, steps: [...policy.steps, newStep(policy)] } : policy;

  const affected = affectedPolicies(saved, draft);
  const affectsSites = new Set(affected.flatMap((p) => sitesOf(p, data.sites).map((s) => s.id))).size;
  const affectsOpen = data.openIncidents
    .filter((i) => affected.some((p) => p.key === i.key))
    .map((i) => i.number);

  const save = () => {
    if (!note.trim()) {
      setNoteError('Add a short note — it goes in the audit log with the change');
      return;
    }
    setFailure(null);
    start(async () => {
      const r = await saveEscalation(toSaveInput(draft, note.trim(), saved));
      if (!r.ok) {
        setFailure(r.message);
        return;
      }
      setSaveOpen(false);
      setNote('');
      setJustSaved(true);
      setRefocus((n) => n + 1);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4">
        <SegmentedControl
          label="Policy"
          value={key}
          onChange={(v) => setKey(v as PolicyKey)}
          options={draft.policies.map((p) => ({ value: p.key, label: POLICY_LABELS[p.key] }))}
        />
        <span className="flex items-center gap-2 text-sm text-fg-secondary">
          <IconClock size="sm" aria-hidden />
          {timerBasis(key, hoursText)}
        </span>
      </div>

      {justSaved && (
        <Alert tone="success" title="Saved" role="status">
          New incidents use it straight away; open incidents keep their current timers. The change is in the
          audit log.
        </Alert>
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <section className="flex min-w-0 flex-col lg:col-span-2" aria-labelledby="escalation-ladder">
          <h2 id="escalation-ladder" ref={ladderHeading} tabIndex={-1} className="sr-only">
            {POLICY_LABELS[key]} steps
          </h2>
          <ol role="list" className="m-0 list-none p-0">
            {policy.steps.map((_, i) => (
              <StepRow
                key={`${policy.id}-${i}`}
                policy={policy}
                index={i}
                admins={data.admins}
                onEdit={(index) => setEditing({ index, adding: false })}
                onDelete={(index) => {
                  setSteps(policy.steps.filter((_s, j) => j !== index));
                  setRefocus((n) => n + 1);
                }}
              />
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-3 pl-14">
            {canAdd(policy) && (
              <Button
                variant="ghost"
                size="sm"
                touchHeight
                icon={<IconPlus />}
                onClick={() => setEditing({ index: policy.steps.length, adding: true })}
              >
                Add step
              </Button>
            )}
            <span className="text-xs text-fg-secondary">
              L0 is pinned. Every step needs at least one channel. Each later step is at least +15 min and
              later than the one before.
            </span>
          </div>
          {message && (
            <p
              className={`m-0 mt-2 flex items-center gap-1.5 pl-14 text-sm ${message.tone === 'danger' ? 'text-fg-danger' : 'text-fg-warning'}`}
            >
              {message.tone === 'danger' ? (
                <IconCircleAlert size="sm" aria-hidden />
              ) : (
                <IconTriangleAlert size="sm" aria-hidden />
              )}
              {message.text}
            </p>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Preview" headingLevel={2}>
            <div className="flex flex-col gap-3">
              {site ? (
                <>
                  <Select
                    label="Resolve for site"
                    touchHeight
                    options={sites.map((s) => ({ value: s.id, label: s.name }))}
                    value={site.id}
                    onChange={(e) => setSiteId(e.target.value)}
                  />
                  <dl className="m-0 flex flex-col rounded-aura-md border border-border-default px-3 py-1 text-sm">
                    {tokenRows(site, data.admins, policy.steps).map((t, i) => (
                      <div
                        key={t.token}
                        className={`flex justify-between gap-3 py-1.5 ${i ? 'border-t border-border-subtle' : ''}`}
                      >
                        <dt className="whitespace-nowrap text-fg-secondary">{t.token}</dt>
                        <dd className="m-0 text-right font-medium">{t.name}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="m-0 text-sm text-fg-secondary">{preview.caseLine}</p>
                  <ol role="list" className="m-0 flex list-none flex-col p-0">
                    {preview.rows.map((r) => (
                      <li
                        key={`${r.at}${r.what}`}
                        className="flex gap-3 border-b border-border-subtle py-2 text-sm"
                      >
                        <span className="w-20 shrink-0 font-mono text-xs whitespace-nowrap text-fg-secondary">
                          {r.at}
                        </span>
                        <span
                          className={r.danger ? 'text-fg-danger' : r.muted ? 'text-fg-secondary' : undefined}
                        >
                          {r.what}
                        </span>
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <p className="m-0 text-sm text-fg-secondary">
                  No live {policy.tier ? `Tier ${policy.tier} ` : ''}sites yet — the preview resolves names
                  once one is monitored.
                </p>
              )}
            </div>
          </Card>

          <Card title="Applies to every step" headingLevel={2}>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="DOWN reminder"
                  suffix="min"
                  inputMode="numeric"
                  value={draft.downReminder}
                  onChange={(e) => change((d) => ({ ...d, downReminder: e.target.value }))}
                  error={reminderError(draft.downReminder) ?? undefined}
                />
                <TextField
                  label="PROBLEM reminder"
                  suffix="min"
                  inputMode="numeric"
                  value={draft.problemReminder}
                  onChange={(e) => change((d) => ({ ...d, problemReminder: e.target.value }))}
                  error={reminderError(draft.problemReminder) ?? undefined}
                />
              </div>
              <dl className="m-0 flex flex-col gap-2 text-sm">
                {[
                  ['Thread', '1 per incident'],
                  ['Chat fails', 'Email fallback'],
                  ['Tier 1 hours', '24/7'],
                  ['Tier 2–3 hours', hoursText],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-fg-secondary">{k}</dt>
                    <dd className="m-0 font-semibold whitespace-nowrap">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </Card>
        </div>
      </div>

      {summary && (
        <UnsavedBar
          label={summary.label}
          hint={summary.hint}
          onDiscard={() => {
            setDraft(saved);
            setRefocus((n) => n + 1);
          }}
          onSave={() => {
            setNoteError(null);
            setFailure(null);
            setSaveOpen(true);
          }}
        />
      )}

      {editing && (
        <StepDialog
          policy={editingPolicy}
          index={editing.index}
          adding={editing.adding}
          admins={data.admins}
          site={site}
          hours={hours}
          now={clock}
          onClose={() => setEditing(null)}
          onApply={(step) => {
            const steps = [...editingPolicy.steps];
            steps[editing.index] = step;
            setSteps(steps);
            // "Add step" goes away once L1 exists (S08): its pencil is new, the heading is stable.
            if (editing.adding) setRefocus((n) => n + 1);
            setEditing(null);
          }}
        />
      )}

      {saveOpen && (
        <SaveDialog
          problems={saveProblems(draft)}
          warnings={saveWarnings(draft)}
          rows={rows}
          affects={affectsLine(affectsSites, affectsOpen)}
          note={note}
          noteError={noteError}
          failure={failure}
          pending={pending}
          onNote={(v) => {
            setNote(v);
            if (v.trim()) setNoteError(null);
          }}
          onSave={save}
          onClose={() => setSaveOpen(false)}
        />
      )}
    </div>
  );
}
