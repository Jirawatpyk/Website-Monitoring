import { z } from 'zod';

/**
 * Escalation policies (S08, D-034; spec §8, §14.7, §15.5). Mirrors the `escalation_steps.targets` /
 * `channels` checks in `supabase/migrations/20261010071955_escalation_policies.sql`.
 */

/** Role tokens a step names; each resolves per site (owner, backup, every active Admin, the client's AM). */
export const ESCALATION_TARGETS = ['owner', 'backup', 'admins', 'site_am', 'ceo'] as const;
export type EscalationTarget = (typeof ESCALATION_TARGETS)[number];

/** On screen. "Owner" reads "Owner / on-call" once on-call exists (S10); the CEO token is S10's too. */
export const ESCALATION_TARGET_LABELS: Record<EscalationTarget, string> = {
  owner: 'Owner',
  backup: 'Backup',
  admins: 'Admin',
  site_am: 'Site AM',
  ceo: 'CEO',
};

/** chat = @mention in the incident thread · space = the Alerts Space post · email · voice (off until approved). */
export const ESCALATION_CHANNELS = ['chat', 'space', 'email', 'voice'] as const;
export type EscalationChannel = (typeof ESCALATION_CHANNELS)[number];

export const ESCALATION_CHANNEL_LABELS: Record<EscalationChannel, string> = {
  chat: 'Chat @mention',
  space: 'Alerts Space',
  email: 'Email',
  voice: 'Voice call',
};

/** A step after L0 waits at least this long (spec §14.7: "L0 covers the first 15 minutes"). */
export const MIN_STEP_DELAY_MIN = 15;

export const escalationStepSchema = z.object({
  level: z.number().int().min(0).max(3),
  delayMin: z.number().int().min(0),
  targets: z.array(z.enum(ESCALATION_TARGETS)),
  channels: z.array(z.enum(ESCALATION_CHANNELS)),
  /**
   * The Tier 1 CEO + Site AM step (spec §14.1, §15.5): it still goes after an acknowledgement, as an
   * FYI if the site is still DOWN, and tells everyone it names (never a call). Absent = an ordinary step.
   */
  fyi: z.boolean().optional(),
});
export type EscalationStep = z.infer<typeof escalationStepSchema>;

/** The policy an incident keeps from when it opened (`incidents.escalation_plan`, D-034). */
export const escalationPlanSchema = z.object({
  severity: z.enum(['down', 'problem']),
  tier: z.number().int().min(1).max(3),
  reminderMin: z.number().int().min(1),
  steps: z.array(escalationStepSchema),
});
export type EscalationPlan = z.infer<typeof escalationPlanSchema>;

/** Response hours for Tier 2–3 (spec §7, §14.14), in Bangkok minutes of the day; ISO days 1 = Monday. */
export interface ResponseHours {
  startMin: number;
  endMin: number;
  days: readonly number[];
  /** Company holidays as Bangkok dates, `YYYY-MM-DD`. */
  holidays: ReadonlySet<string>;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** "Mon–Fri 09:00–18:00" (a run of days) or "Mon, Wed 09:00–18:00" — the Escalation and Organisation pages. */
export function formatResponseHours(h: Pick<ResponseHours, 'startMin' | 'endMin' | 'days'>): string {
  const days = [...h.days].sort((a, b) => a - b);
  const run = days.length > 1 && days.every((d, i) => i === 0 || d === days[i - 1]! + 1);
  const dayText = run
    ? `${WEEKDAYS[days[0]! - 1]}–${WEEKDAYS[days.at(-1)! - 1]}`
    : days.map((d) => WEEKDAYS[d - 1]).join(', ');
  return `${dayText} ${hhmm(h.startMin)}–${hhmm(h.endMin)}`;
}

/** "09:00" / "09:00:00" (a Postgres `time`) → minutes of the day. */
export function timeToMinutes(value: string): number {
  const [h = '0', m = '0'] = value.split(':');
  return Number(h) * 60 + Number(m);
}
