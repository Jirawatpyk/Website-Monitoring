'use client';

import { Button, Card, SegmentedControl, Select, TextField } from '@jirawatpyk/aura-react';
import { IconCircleAlert, IconClock, IconPlus, IconTriangleAlert } from '@jirawatpyk/aura-react/icons';
import type { EscalationStep } from '@dxt/shared';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
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
 * on the page until "Save and log".
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
  const [pending, start] = useTransition();

  const policy = draft.policies.find((p) => p.key === key) ?? draft.policies[0]!;
  const sites = sitesOf(policy, data.sites);
  const [siteId, setSiteId] = useState<string | null>(null);
  const site = sites.find((s) => s.id === siteId) ?? sites[0];
  const hours = useMemo(() => hoursOf(data.hours), [data.hours]);
  const clock = useNow(now);
  const preview = scenario(policy, site, data.admins, hours, clock);
  const rows = diff(saved, draft);
  const summary = unsavedSummary(rows);
  const message = policyMessage(policy);

  const setSteps = (steps: EscalationStep[]) =>
    setDraft((d) => ({
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
          {timerBasis(key)}
        </span>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col lg:col-span-2">
          <ol className="m-0 list-none p-0" aria-label={`${POLICY_LABELS[key]} steps`}>
            {policy.steps.map((_, i) => (
              <StepRow
                key={`${policy.id}-${i}`}
                policy={policy}
                index={i}
                onEdit={(index) => setEditing({ index, adding: false })}
                onDelete={(index) => setSteps(policy.steps.filter((_s, j) => j !== index))}
              />
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-3 pl-14">
            {canAdd(policy) && (
              <Button
                variant="ghost"
                size="sm"
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
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Preview">
            <div className="flex flex-col gap-3">
              <Select
                label="Resolve for site"
                options={sites.map((s) => ({ value: s.id, label: s.name }))}
                value={site?.id ?? ''}
                onChange={(e) => setSiteId(e.target.value)}
              />
              <dl className="m-0 flex flex-col rounded-aura-md border border-border-default px-3 py-1 text-sm">
                {tokenRows(site, data.admins).map((t, i) => (
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
              <ol className="m-0 flex list-none flex-col p-0">
                {preview.rows.map((r) => (
                  <li
                    key={`${r.at}${r.what}`}
                    className="flex gap-3 border-b border-border-subtle py-2 text-sm"
                  >
                    <span className="w-18 shrink-0 font-mono text-xs text-fg-secondary">{r.at}</span>
                    <span className={r.danger ? 'text-fg-danger' : r.muted ? 'text-fg-secondary' : undefined}>
                      {r.what}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </Card>

          <Card title="Applies to every step">
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="DOWN reminder"
                  suffix="min"
                  inputMode="numeric"
                  value={draft.downReminder}
                  onChange={(e) => setDraft((d) => ({ ...d, downReminder: e.target.value }))}
                  error={reminderError(draft.downReminder) ?? undefined}
                />
                <TextField
                  label="PROBLEM reminder"
                  suffix="min"
                  inputMode="numeric"
                  value={draft.problemReminder}
                  onChange={(e) => setDraft((d) => ({ ...d, problemReminder: e.target.value }))}
                  error={reminderError(draft.problemReminder) ?? undefined}
                />
              </div>
              <dl className="m-0 flex flex-col gap-2 text-sm">
                {[
                  ['Thread', '1 per incident'],
                  ['Chat fails', 'Email fallback'],
                  ['Tier 1 hours', '24/7'],
                  ['Tier 2–3 hours', hoursLabel(data.hours)],
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
          onDiscard={() => setDraft(saved)}
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
          onClose={() => setEditing(null)}
          onApply={(step) => {
            const steps = [...editingPolicy.steps];
            steps[editing.index] = step;
            setSteps(steps);
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
