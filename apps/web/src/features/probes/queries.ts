import 'server-only';
import { PROBE_LOCATIONS, type ProbeLocation } from '@dxt/shared';
import type { DbClient } from '@dxt/db';
import { loadOnCallNow } from '@/features/incidents/server';
import {
  beatRowsOf,
  gapLinesOf,
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
    delivery: { waiting: number; sent24h: number; failed24h: number } | null;
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
  const [locations, beats, activity, gaps, admins, queue, lastJob, onCallId, waiting, sent, failed] =
    await Promise.all([
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
    ]);
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
  const onCallName = onCallId
    ? (check('profiles', await db.from('profiles').select('display_name').eq('id', onCallId).maybeSingle())
        .data?.display_name ?? null)
    : null;
  const job = lastJob.data;
  return {
    nowIso: now.toISOString(),
    summary: summaryOf(rows),
    probes: probeCardsOf(activity.data ?? [], gaps.data ?? [], lastBeat, now),
    beats: rows,
    gapLines: gapLinesOf(gaps.data ?? []),
    onCallName,
    admins: admins.count ?? 0,
    pipeline: {
      sweepAt: beatAt('engine-sweep'),
      notifierAt: beatAt('notifier'),
      delivery:
        waiting && sent && failed
          ? { waiting: waiting.count ?? 0, sent24h: sent.count ?? 0, failed24h: failed.count ?? 0 }
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
