import { Button, Checkbox, Dialog, Tag, TextField } from '@jirawatpyk/aura-react';
import { IconCheck, IconCircleAlert, IconUser } from '@jirawatpyk/aura-react/icons';
import {
  ESCALATION_TARGET_LABELS,
  type EscalationChannel,
  type EscalationStep,
  type EscalationTarget,
} from '@dxt/shared';
import { useState } from 'react';
import { delayCheck, policyShort, type PolicyDraft } from '../model';

/** S08 offers these tokens; the CEO is S10's (Tier 1 DOWN from L2, §15.5). */
const TOKENS: readonly EscalationTarget[] = ['owner', 'backup', 'admins', 'site_am', 'ceo'];

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
  onApply,
  onClose,
}: {
  policy: PolicyDraft;
  index: number;
  adding: boolean;
  admins: readonly string[];
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
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const channel = (c: EscalationChannel) => (on: boolean) =>
    setChannels((list) => (on ? [...new Set([...list, c])] : list.filter((x) => x !== c)));
  const nobody = !targets.length;
  const apply = () => {
    setTried(true);
    if (check.error || nobody) return;
    onApply({ ...start, delayMin: Number(delay), targets, channels });
  };
  const adminNote = admins.length === 1 ? `${admins[0]} is the only active Admin.` : null;

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
                disabled={t === 'ceo'}
                touchHeight
                onClick={() => setTargets((list) => toggle(list, t))}
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
              : 'Pick who this step notifies. Tokens resolve per site — see the preview.'}
          </span>
          <span className="text-xs text-fg-secondary">CEO is available from L2 onward.</span>
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
          <Checkbox
            checked={false}
            disabled
            description="Only the L2 CEO step can carry a voice call, and it stays off until approved."
          >
            Voice call
          </Checkbox>
          {!channels.length && (
            <span className="flex items-center gap-1.5 text-xs text-fg-danger">
              <IconCircleAlert size="sm" aria-hidden />
              No channel ticked — this step notifies nobody. You can apply it, but Save stays blocked.
            </span>
          )}
        </fieldset>
      </div>
    </Dialog>
  );
}
