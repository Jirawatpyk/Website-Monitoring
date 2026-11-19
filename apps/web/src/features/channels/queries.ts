import 'server-only';
import { bangkokDayStart, timeToMinutes, type EscalationStep } from '@dxt/shared';
import type { ServerClient } from '@/lib/supabase/server';
import { latencyMs, type ChannelFacts, type Ladders, type LogNotification } from './model';

export interface ChannelsData {
  facts: ChannelFacts;
  ladders: Ladders;
  /** Active Admins by name (the Monitor fault row). */
  admins: string[];
  reminders: { downMin: number; problemMin: number };
  hours: { startMin: number; endMin: number; days: number[] };
  log: LogNotification[];
  /** The viewer can send a Chat test (has a Chat id). */
  canTestChat: boolean;
}

type StepRow = {
  policy_id: string;
  level: number;
  delay_min: number;
  targets: string[];
  channels: string[];
  fyi: boolean;
};

const toStep = (s: StepRow): EscalationStep =>
  ({
    level: s.level,
    delayMin: s.delay_min,
    targets: s.targets,
    channels: s.channels,
    fyi: s.fyi,
  }) as EscalationStep;

/**
 * Alert channels for an Admin (RLS as the user: notifications are Admin-only, policies staff). The env
 * gives only booleans and the sender address — never a webhook URL or a key.
 */
export async function loadChannels(
  db: ServerClient,
  env: { chatConnected: boolean; emailFrom: string | null },
  viewerId: string,
  now: Date,
): Promise<ChannelsData> {
  const dayStart = bangkokDayStart(now).toISOString();
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  const [policies, steps, settings, admins, me, lastChat, sent, failed, log] = await Promise.all([
    db.from('escalation_policies').select('id, severity, tier'),
    db.from('escalation_steps').select('policy_id, level, delay_min, targets, channels, fyi').order('level'),
    db
      .from('organisation_settings')
      .select('response_start, response_end, response_days, down_reminder_min, problem_reminder_min')
      .single(),
    db
      .from('profiles')
      .select('display_name')
      .eq('role', 'admin')
      .eq('is_active', true)
      .order('display_name'),
    db.from('profiles').select('google_chat_user_id').eq('id', viewerId).single(),
    db
      .from('notifications')
      .select('sent_at, created_at, hold_until')
      .eq('channel', 'google_chat')
      .eq('status', 'sent')
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('channel', 'email')
      .eq('status', 'sent')
      .gte('sent_at', dayAgo),
    db
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('channel', 'email')
      .eq('status', 'failed')
      .gte('updated_at', dayAgo),
    db
      .from('notifications')
      .select(
        `id, channel, template, status, attempts, created_at, hold_until, sent_at,
         incident:incidents(number), report:reports(kind), event:oncall_events(kind, tester:profiles!oncall_events_user_id_fkey(display_name)),
         person:profiles(display_name)`,
      )
      .gte('created_at', dayStart)
      // The log's own rows, filtered in SQL so a busy day's other messages can't crowd them out.
      .or('incident_id.not.is.null,report_id.not.is.null,oncall_event_id.not.is.null,attempts.gt.1')
      .order('created_at', { ascending: false })
      .limit(200),
  ]);
  for (const [name, r] of [
    ['escalation_policies', policies],
    ['escalation_steps', steps],
    ['organisation_settings', settings],
    ['profiles', admins],
    ['profiles', me],
    ['notifications', lastChat],
    ['notifications', sent],
    ['notifications', failed],
    ['notifications', log],
  ] as const)
    if (r.error) throw new Error(`${name}: ${r.error.message}`);

  const stepsOf = (severity: string, tier: number | null) => {
    const p = (policies.data ?? []).find((x) => x.severity === severity && x.tier === tier);
    return ((steps.data ?? []) as StepRow[]).filter((s) => p && s.policy_id === p.id).map(toStep);
  };
  const s = settings.data!;
  const last = lastChat.data;
  return {
    facts: {
      chatConnected: env.chatConnected,
      emailConnected: !!env.emailFrom,
      emailFrom: env.emailFrom,
      lastChat: last?.sent_at
        ? {
            at: last.sent_at,
            latencyMs: latencyMs({
              createdAt: last.created_at,
              holdUntil: last.hold_until,
              sentAt: last.sent_at,
            }),
          }
        : null,
      email24h: { sent: sent.count ?? 0, failed: failed.count ?? 0 },
    },
    ladders: {
      t1Down: stepsOf('down', 1),
      t2Down: stepsOf('down', 2),
      t3Down: stepsOf('down', 3),
      problem: stepsOf('problem', null),
    },
    admins: (admins.data ?? []).map((a) => a.display_name),
    reminders: { downMin: s.down_reminder_min, problemMin: s.problem_reminder_min },
    hours: {
      startMin: timeToMinutes(s.response_start),
      endMin: timeToMinutes(s.response_end),
      days: s.response_days,
    },
    log: (log.data ?? []).map((n) => ({
      id: n.id,
      channel: n.channel,
      template: n.template,
      status: n.status,
      attempts: n.attempts,
      createdAt: n.created_at,
      holdUntil: n.hold_until,
      sentAt: n.sent_at,
      incidentNumber: n.incident?.number ?? null,
      reportKind: (n.report?.kind as 'daily' | 'weekly' | undefined) ?? null,
      oncallKind: n.event?.kind ?? null,
      chatTo: n.event?.tester?.display_name ?? null,
      to: n.person?.display_name ?? null,
    })),
    canTestChat: !!me.data?.google_chat_user_id?.trim(),
  };
}
