import 'server-only';
import { PROBE_LOCATIONS, type ProbeLocation } from '@dxt/shared';
import type { DbClient } from '@dxt/db';
import { loadOnCallNow } from '@/features/incidents/server';
import {
  beatRowsOf,
  gapLinesOf,
  ongoingGaps,
  probeCardsOf,
  summaryOf,
  type BeatRow,
  type ProbeCard,
  type Summary,
} from './model';

export interface ProbesData {
  nowIso: string;
  summary: Summary;
  probes: ProbeCard[];
  beats: BeatRow[];
  gapLines: { at: string; text: string }[];
  /** Who hears about monitor faults: the person on call, and how many active Admins get the email. */
  onCallName: string | null;
  admins: number;
  pipeline: {
    sweepAt: string | null;
    notifierAt: string | null;
    /** Admins only (notifications are Admin-read): null for everyone else. */
    delivery: { waiting: number; sent24h: number; failed24h: number; fallback24h: number } | null;
  };
  verifier: {
    seenAt: string | null;
    queue: number;
    lastJob: { at: string; site: string; result: 'loaded' | 'failed' | 'blocked' | null } | null;
  };
}

const check = <T extends { error: { message: string } | null }>(name: string, r: T): T => {
  if (r.error) throw new Error(`${name}: ${r.error.message}`);
  return r;
};

/** Everything `/probes` shows, read as the signed-in person (staff; delivery counts for Admins). */
export async function loadProbes(
  db: DbClient,
  isAdmin: boolean,
  now: Date = new Date(),
): Promise<ProbesData> {
  const since24h = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const count = (status: 'queued' | 'sent' | 'failed', sinceIso?: string) => {
    let q = db.from('notifications').select('id', { count: 'exact', head: true }).eq('status', status);
    // sent: by sent_at (notifications_sent_at_idx); failed rows are few (the status prefix of the due index)
    if (sinceIso) q = q.gte(status === 'sent' ? 'sent_at' : 'updated_at', sinceIso);
    return q;
  };
  const [
    locations,
    beats,
    activity,
    gaps,
    admins,
    queue,
    lastJob,
    onCallId,
    waiting,
    sent,
    failed,
    mails,
    fallback,
  ] = await Promise.all([
    db.from('probe_locations').select('code, is_active, last_heartbeat_at'),
    db.from('agent_heartbeats').select('name, last_seen_at'),
    db.rpc('probe_activity_24h'),
    db.rpc('probe_gaps_24h'),
    db
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
      .eq('is_active', true),
    db
      .from('verification_jobs')
      .select('id', { count: 'exact', head: true })
      .in('status', ['queued', 'leased']),
    db
      .from('verification_jobs')
      .select('completed_at, result, sites(name)')
      .eq('status', 'done')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    loadOnCallNow(db, now),
    isAdmin ? count('queued') : null,
    isAdmin ? count('sent', since24h) : null,
    isAdmin ? count('failed', since24h) : null,
    // §15.3 "one email to Tao at 03:15 — show it in Probes": system alerts are Admin-read
    isAdmin
      ? db
          .from('system_alerts')
          .select('context, opened_at')
          .eq('kind', 'probe_location_missing')
          .gte('opened_at', since24h)
      : null,
    // D-016's fallback emails (a Chat alert that failed) carry context.fallback (queue_fallback_emails)
    isAdmin
      ? db
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .contains('context', { fallback: true })
          .gte('created_at', since24h)
      : null,
  ]);
  if (mails) check('system_alerts', mails);
  if (fallback) check('notifications', fallback);
  for (const [name, r] of Object.entries({ locations, beats, activity, gaps, admins, queue, lastJob }))
    check(name, r);
  for (const [name, r] of Object.entries({ waiting, sent, failed })) if (r) check(name, r);

  const beatAt = (name: string) => beats.data?.find((b) => b.name === name)?.last_seen_at ?? null;
  const active = (locations.data ?? []).filter((l) => l.is_active);
  const lastBeat = Object.fromEntries(
    PROBE_LOCATIONS.map((code) => [code, active.find((l) => l.code === code)?.last_heartbeat_at ?? null]),
  ) as Record<ProbeLocation, string | null>;
  const rows = beatRowsOf(
    {
      engineSweep: beatAt('engine-sweep'),
      notifier: beatAt('notifier'),
      crawler: beatAt('crawler'),
      verifier: beatAt('verifier'),
      watchdog: beatAt('vps-watchdog'),
      locations: lastBeat,
    },
    now,
  );
  const onCall = onCallId
    ? check(
        'profiles',
        await db
          .from('profiles')
          .select('display_name, google_chat_user_id')
          .eq('id', onCallId)
          .maybeSingle(),
      ).data
    : null;
  // The watchdog can only @mention someone with a Chat id (the Overview banner's rule too).
  const onCallName = onCall?.google_chat_user_id ? onCall.display_name : null;
  const job = lastJob.data;
  // closed gaps from SQL + a silence still going on: the cards and the lines read the same rows
  const allGaps = [...(gaps.data ?? []), ...ongoingGaps(lastBeat, now)];
  return {
    nowIso: now.toISOString(),
    summary: summaryOf(rows),
    probes: probeCardsOf(activity.data ?? [], allGaps, lastBeat, now),
    beats: rows,
    gapLines: gapLinesOf(allGaps, mails ? (mails.data ?? []) : null),
    onCallName,
    admins: admins.count ?? 0,
    pipeline: {
      sweepAt: beatAt('engine-sweep'),
      notifierAt: beatAt('notifier'),
      delivery:
        waiting && sent && failed
          ? {
              waiting: waiting.count ?? 0,
              sent24h: sent.count ?? 0,
              failed24h: failed.count ?? 0,
              fallback24h: fallback?.count ?? 0,
            }
          : null,
    },
    verifier: {
      seenAt: beatAt('verifier'),
      queue: queue.count ?? 0,
      lastJob: job?.completed_at
        ? {
            at: job.completed_at,
            site: job.sites?.name ?? '',
            result: (job.result as 'loaded' | 'failed' | 'blocked' | null) ?? null,
          }
        : null,
    },
  };
}
