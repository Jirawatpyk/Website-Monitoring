import { Button, Checkbox, Dialog, Tag, TextField } from '@jirawatpyk/aura-react';
import { IconCheck, IconCircleAlert, IconUser } from '@jirawatpyk/aura-react/icons';
import {
  ESCALATION_TARGET_LABELS,
  type EscalationChannel,
  type EscalationStep,
  type EscalationTarget,
  type ResponseHours,
} from '@dxt/shared';
import { useState } from 'react';
import { delayCheck, policyShort, type PolicyDraft } from '../model';
import { scenario } from '../preview';
import type { PreviewSite } from '../types';

/** The role tokens; the CEO only on Tier 1 DOWN from L2 (§15.5). */
const TOKENS: readonly EscalationTarget[] = ['owner', 'backup', 'admins', 'ceo', 'site_am'];

/** The CEO line under the tokens (Escalation board `eCeoNote`). */
function ceoNote(key: PolicyDraft['key'], index: number, fyi: boolean): string {
  if (fyi)
    return 'CEO + Site AM are fixed on this step: it’s the Tier 1 step that still sends an FYI after acknowledge (never a call). It can’t be removed.';
  if (key !== 't1')
    return 'CEO isn’t available here — the CEO is paged only on Tier 1 DOWN, from L2 onward. On this policy the CEO sees incidents in the daily digest.';
  return index < 2 ? 'CEO is available from L2 onward.' : 'Adding CEO keeps this step at L2 or later.';
}

/**
 * Edit L1 / Add L1 (Escalation board edit dialog): delay, role tokens, channels. Changes stay on the
 * page until the save dialog (the board's model); a step that breaks a rule can be applied, but Save
 * stays blocked.
 */
export function StepDialog({
  policy,
  index,
  adding,
  admins,
  site,
  hours,
  now,
  onApply,
  onClose,
}: {
  policy: PolicyDraft;
  index: number;
  adding: boolean;
  admins: readonly string[];
  /** The Preview's site: the dialog's own preview line names its people (Escalation board). */
  site: PreviewSite | undefined;
  hours: ResponseHours;
  now: Date;
  onApply: (step: EscalationStep) => void;
  onClose: () => void;
}) {
  const start = policy.steps[index]!;
  const [delay, setDelay] = useState(String(start.delayMin));
  const [targets, setTargets] = useState<EscalationTarget[]>(start.targets);
  const [channels, setChannels] = useState<EscalationChannel[]>(start.channels);
  const [tried, setTried] = useState(false);
  const label = `L${index}`;
  const check = delayCheck(delay, policy.steps, index);
  const fyi = !!start.fyi;
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  // The board's locks: CEO + Site AM fixed on the FYI step; the CEO only on Tier 1 from L2.
  const locked = (t: EscalationTarget) =>
    (fyi && (t === 'ceo' || t === 'site_am')) ||
    (t === 'ceo' && !targets.includes('ceo') && (policy.key !== 't1' || index < 2));
  const pick = (t: EscalationTarget) => {
    if (locked(t)) return;
    const next = toggle(targets, t);
    setTargets(next);
    // Voice rides only on a CEO step: taking the CEO off drops it.
    if (t === 'ceo' && !next.includes('ceo')) setChannels((list) => list.filter((c) => c !== 'voice'));
  };
  const voice = channels.includes('voice');
  const channel = (c: EscalationChannel) => (on: boolean) =>
    setChannels((list) => (on ? [...new Set([...list, c])] : list.filter((x) => x !== c)));
  const nobody = !targets.length;
  const apply = () => {
    setTried(true);
    if (check.error || nobody) return;
    onApply({ ...start, delayMin: Number(delay), targets, channels });
  };
  const adminNote = admins.length === 1 ? `${admins[0]} is the only active Admin.` : null;
  // The step as it would be applied, previewed for the site (board: "10:03 · L1 → Ploy + Tao (MuvMi)").
  const trial = {
    ...policy,
    steps: policy.steps.map((s, i) =>
      i === index ? { ...s, delayMin: check.error ? s.delayMin : Number(delay), targets, channels } : s,
    ),
  };
  const row = scenario(trial, site, admins, hours, now).rows.find(
    (r) => r.level === trial.steps[index]?.level,
  )!;
  const preview = { ...row, what: site ? `${row.what} (${site.name})` : row.what };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`${adding ? 'Add' : 'Edit'} ${label} · ${policyShort(policy.key)}`}
      description={
        adding
          ? 'New steps go at the end of the ladder. Nothing changes until you save the page.'
          : 'Changes stay on this page until you save — the save step lists everything and asks for a note.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={<IconCheck />} onClick={apply}>
            {adding ? `Add ${label}` : `Apply to ${label}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          label="Notify after"
          suffix="min after Confirmed down"
          inputMode="numeric"
          value={delay}
          onChange={(e) => setDelay(e.target.value)}
          error={check.error ?? undefined}
          hint={check.hint ?? undefined}
        />
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-sm font-medium">Who · role tokens</legend>
          <div className="flex flex-wrap gap-2">
            {TOKENS.map((t) => (
              <Tag
                key={t}
                icon={<IconUser />}
                selected={targets.includes(t)}
                disabled={locked(t)}
                touchHeight
                onClick={() => pick(t)}
              >
                {t === 'admins' && adminNote
                  ? `Admin (${admins[0]}) · only Admin`
                  : ESCALATION_TARGET_LABELS[t]}
              </Tag>
            ))}
          </div>
          <span className={`text-xs ${tried && nobody ? 'text-fg-danger' : 'text-fg-secondary'}`}>
            {tried && nobody
              ? 'Pick at least one person.'
              : targets.length
                ? `Tokens resolve per site.${targets.includes('admins') && adminNote ? ` ${adminNote}` : ''}`
                : 'Pick who this step notifies. Tokens resolve per site — see the preview.'}
          </span>
          <span className="text-xs text-fg-secondary">{ceoNote(policy.key, index, fyi)}</span>
        </fieldset>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-sm font-medium">Channels</legend>
          <Checkbox checked={channels.includes('chat')} onChange={channel('chat')}>
            Chat @mention
          </Checkbox>
          <Checkbox checked={channels.includes('space')} onChange={channel('space')}>
            Alerts Space
          </Checkbox>
          <Checkbox checked={channels.includes('email')} onChange={channel('email')}>
            Email
          </Checkbox>
          {/* Voice: configured on the Tier 1 CEO step, off until approved (D-009) — never editable here. */}
          <Checkbox
            checked={voice}
            disabled
            description={
              voice
                ? 'Set up on this step but stays off until the CEO approves voice calls and Twilio is set up (~$23–26 / month).'
                : fyi
                  ? 'Never on this step — the FYI goes by Chat @mention + email only.'
                  : 'Only the L2 CEO step can carry a voice call, and it stays off until approved.'
            }
          >
            {voice ? 'Voice call · Configured · off until approved' : 'Voice call'}
          </Checkbox>
          {!channels.some((c) => c !== 'voice') && (
            <span className="flex items-center gap-1.5 text-xs text-fg-danger">
              <IconCircleAlert size="sm" aria-hidden />
              No channel ticked — this step notifies nobody. You can apply it, but Save stays blocked.
            </span>
          )}
        </fieldset>
        {targets.includes('ceo') && !fyi && (
          <p className="m-0 text-xs text-fg-secondary">This step pages the CEO, so it can’t move above L2.</p>
        )}
        <p className="m-0 flex gap-2.5 rounded-aura-md border border-border-default px-3.5 py-2.5 text-sm">
          <span className="shrink-0 font-mono text-xs whitespace-nowrap text-fg-secondary">{preview.at}</span>
          <span className={preview.danger ? 'text-fg-danger' : undefined}>{preview.what}</span>
        </p>
      </div>
    </Dialog>
  );
}
