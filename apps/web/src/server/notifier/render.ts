import 'server-only';
import { episodesFromTimeline, outageMinutes, type Episode } from '@dxt/engine';
import {
  buildAcknowledgedAlert,
  buildAcknowledgedEmail,
  buildAgainAlert,
  buildAgainEmail,
  buildNewCauseAlert,
  buildNewCauseEmail,
  buildAutoResolvedAlert,
  buildAutoResolvedEmail,
  buildFlapSummaryAlert,
  buildFlapSummaryEmail,
  buildIncidentMutedLine,
  buildNoteAlert,
  buildResolvedAlert,
  buildResolvedEmail,
  buildDownAlert,
  manualCause,
  buildDownEmail,
  buildProblemAlert,
  buildProblemEmail,
  buildRecoveredAlert,
  buildRecoveredEmail,
  buildReminderAlert,
  buildStepAlert,
  buildStepEmail,
  buildSystemAlertEmail,
  buildClientUpdateDueAlert,
  buildClientUpdateDueEmail,
  plainName,
  type ChatMessage,
  type ChatPerson,
  type EmailBaseInput,
  type EmailMessage,
  type EmailReason,
  type KeyPageFacts,
  type ProblemFacts,
  type StatusNote,
  type StillExpiry,
  type VerifierDownReason,
  expiryNow,
} from '@dxt/notifier';
import {
  clockMinutes,
  confirmedByWafOf,
  formatTime,
  PROBE_LOCATIONS,
  ROOT_CAUSE_CATEGORIES,
  ROOT_CAUSE_LABELS,
  TIER_CONFIG,
  TRIGGER_LABELS,
  type ProbeLocation,
  type RootCauseCategory,
  type Tier,
  type Trigger,
} from '@dxt/shared';
import {
  contextOf,
  l0IsOnCall,
  l0Of,
  type IncidentFacts,
  type Notification,
  type Recipient,
  type SystemAlertFacts,
} from './facts';
import {
  l0PeopleOf,
  l0PersonsOf,
  ladderFactsOf,
  namedIn,
  readerOf,
  stepFactsOf,
  stepWhy,
  stoppedOf,
  toldAtOf,
} from './ladder-facts';

const L0_TEMPLATES = new Set(['down', 'problem', 'down_again', 'problem_again', 'flap_summary']);

const person = (p: IncidentFacts['sites']['primary']): ChatPerson | null =>
  p ? { name: p.display_name, chatUserId: p.google_chat_user_id } : null;

const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);

/** The people the L0 pencil adds (S10): everyone L0 names but the owner / on-call. */
const alsoL0 = (i: IncidentFacts): ChatPerson[] => {
  const main = l0Of(i)?.id;
  return l0PersonsOf(i)
    .filter((p) => p.id !== main)
    .map((p) => ({ name: p.display_name, chatUserId: p.google_chat_user_id }));
};
const num = (v: unknown, fallback: number) => (typeof v === 'number' ? v : fallback);

export const incidentUrl = (appUrl: string, incidentId: string) =>
  new URL(`/incidents/${incidentId}`, appUrl).toString();

/** A PROBLEM incident's replies say "still slow" / "problem cleared" instead of the DOWN wording. */
function problemOf(i: IncidentFacts, ctx: Record<string, unknown> = {}): ProblemFacts | null {
  if (i.severity !== 'problem') return null;
  const tier = (i.sites.tier >= 1 && i.sites.tier <= 3 ? i.sites.tier : 2) as Tier;
  // The engine stores the monitor's own limit with RECOVERED; the tier's otherwise.
  const own = typeof ctx.slowLimitMs === 'number' ? ctx.slowLimitMs : null;
  return { trigger: i.trigger, slowLimitMs: own ?? TIER_CONFIG[tier].slowThresholdMs };
}

const dateOf = (v: unknown): Date | null =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v) : null;

/**
 * The incident's drops from its timeline (D-024), each with its own severity — the same drops uptime
 * reads (S06): a D-021 incident's PROBLEM before the outage is a PROBLEM drop, a D-023 key-page drop
 * on a DOWN incident too. D-033: "down X" totals count the DOWN drops only.
 */
function dropsOf(i: IncidentFacts): Episode[] {
  return episodesFromTimeline(i, i.incident_events ?? []);
}

/**
 * When the incident's latest drop of this severity was confirmed, if it isn't the first one (D-058):
 * a step after a relapse says "Down for 15 min (down again 07:44)", not the days since the first drop.
 */
function againAtOf(i: IncidentFacts, severity: 'down' | 'problem'): Date | null {
  const drops = dropsOf(i).filter((d) => d.severity === severity);
  const last = drops.at(-1);
  return drops.length > 1 && last ? (last.confirmedAt ?? last.start) : null;
}

/**
 * When the latest DOWN drop was confirmed (the FYI's "since", D-078): after a D-021 escalation that is
 * the DOWN, not the PROBLEM's detection; with no DOWN drop recorded, the incident's detection.
 */
function downSinceOf(i: IncidentFacts): Date {
  const last = dropsOf(i)
    .filter((d) => d.severity === 'down')
    .at(-1);
  return last ? (last.confirmedAt ?? last.start) : new Date(i.detected_at);
}

/** How long it had been down at `at` (D-033's one number: DOWN drops only), for ACKNOWLEDGED "so far". */
function outageAt(i: IncidentFacts, at: Date): number | null {
  const upTo = dropsOf(i)
    .filter((d) => d.start <= at)
    .map((d) => ({ ...d, end: d.end && d.end < at ? d.end : at }));
  return outageMinutes(upTo, at);
}

const closedDrops = (i: IncidentFacts) =>
  dropsOf(i).flatMap((d) => (d.end ? [{ start: d.start, end: d.end, severity: d.severity }] : []));

/** A DOWN summary once any drop was an outage; a PROBLEM one only when nothing went down. */
const summarySeverity = (i: IncidentFacts): 'down' | 'problem' =>
  dropsOf(i).some((d) => d.severity === 'down') ? 'down' : 'problem';

/**
 * The drop a RECOVERED row ends (its own recovery time, else the incident's latest), with the severity
 * and trigger of that drop (S06 review N3): a key page's PROBLEM recovering on a DOWN incident (D-023)
 * reads "back to normal · problem for X", not "is back · down X".
 */
function recoveryOf(
  i: IncidentFacts,
  ctx: Record<string, unknown>,
): { start: Date; end: Date; severity: 'down' | 'problem'; trigger: IncidentFacts['trigger'] } | null {
  const end = dateOf(ctx.recoveredAt) ?? dateOf(i.recovered_at);
  if (!end) return null;
  const drop = dropsOf(i).find((d) => d.end && d.end.getTime() === end.getTime());
  const start = drop?.start ?? new Date(i.started_at);
  const relapse = i.incident_events?.find(
    (e) => e.type === 'relapsed' && dateOf(contextOf(e.payload).startedAt)?.getTime() === start.getTime(),
  );
  const relapseTrigger = relapse ? contextOf(relapse.payload).trigger : undefined;
  return {
    start,
    end,
    severity: drop?.severity ?? i.severity,
    trigger: (typeof relapseTrigger === 'string' ? relapseTrigger : i.trigger) as IncidentFacts['trigger'],
  };
}

/** problemOf for the drop that recovered (N3). */
const dropProblem = (
  i: IncidentFacts,
  drop: { severity: 'down' | 'problem'; trigger: IncidentFacts['trigger'] },
  ctx: Record<string, unknown>,
): ProblemFacts | null =>
  drop.severity === 'problem' ? problemOf({ ...i, severity: 'problem', trigger: drop.trigger }, ctx) : null;

function keyPageOf(v: unknown): KeyPageFacts | null {
  const k = (v ?? {}) as Record<string, unknown>;
  return typeof k.path === 'string' && typeof k.failure === 'string' && typeof k.cause === 'string'
    ? { path: k.path, failure: k.failure, cause: k.cause }
    : null;
}

/** The facts the incident opened with (its `detected` event). */
const openedWith = (i: IncidentFacts) =>
  contextOf(i.incident_events?.find((e) => e.type === 'detected')?.payload ?? null);

/** DOWN AGAIN / PROBLEM AGAIN: who acts now, the drop, the incident's downtime before it. */
function againAlert(n: Notification, i: IncidentFacts, now: Date = new Date(n.created_at)): ChatMessage {
  const ctx = contextOf(n.context);
  const droppedAt = dateOf(ctx.startedAt) ?? new Date(n.created_at);
  const down = n.template === 'down_again';
  // "Down 7 min so far" counts the DOWN drops only (D-033); "with a problem … so far" every drop.
  const before = dropsOf(i).filter((d) => d.end && d.end <= droppedAt && (!down || d.severity === 'down'));
  const minutesSoFar = before.reduce((sum, d) => sum + clockMinutes(d.start, d.end!), 0);
  const acked = !!i.acked_at && !!i.acker;
  return buildAgainAlert({
    incidentId: i.id,
    incidentNumber: i.number,
    site: i.sites.name,
    tier: i.sites.tier,
    severity: n.template === 'down_again' ? 'down' : 'problem',
    trigger: (typeof ctx.trigger === 'string' ? ctx.trigger : i.trigger) as IncidentFacts['trigger'],
    // §19.3: whoever acts now — the person who acknowledged, else the L0 person (owner / on-call).
    mention: acked
      ? { name: i.acker!.display_name, chatUserId: i.acker!.google_chat_user_id ?? null }
      : person(l0Of(i)),
    ackedBy: acked ? i.acker!.display_name : null,
    fromState: str(ctx.fromState, 'monitoring'),
    droppedAt,
    backSince: dateOf(ctx.backSince),
    minutesSoFar,
    nowFlapping: ctx.nowFlapping === true,
    flapping: ctx.flapping === true,
    summary: typeof ctx.summary === 'string' ? ctx.summary : null,
    homeBack: ctx.homeBackAt ? keyPageOf(ctx.keyPage) : null,
    // S08: a Tier 2–3 DOWN AGAIN outside response hours says the timers are paused (D-034).
    pausedUntil: down && !acked ? (ladderFactsOf(i, now)?.pausedUntil ?? null) : null,
    manual: manualOf(ctx),
  });
}

/** D-067: the expiry incident's new, more urgent cause — whoever acts now is mentioned (§19.3). */
function newCauseAlert(n: Notification, i: IncidentFacts): ChatMessage {
  const ctx = contextOf(n.context);
  const acked = !!i.acked_at && !!i.acker;
  const aside = setAsideOf(ctx);
  return buildNewCauseAlert({
    incidentId: i.id,
    incidentNumber: i.number,
    site: i.sites.name,
    tier: i.sites.tier,
    was: str(ctx.was, 'ssl') as IncidentFacts['trigger'],
    trigger: (typeof ctx.trigger === 'string' ? ctx.trigger : i.trigger) as IncidentFacts['trigger'],
    summary: str(ctx.summary, 'problem'),
    cause: str(ctx.cause, 'Problem'),
    mention: acked
      ? { name: i.acker!.display_name, chatUserId: i.acker!.google_chat_user_id ?? null }
      : (nightMention(ctx) ?? person(l0Of(i))),
    ackedBy: acked ? i.acker!.display_name : (aside?.by ?? null),
    setAside: !acked && !!aside,
    afterDown: ctx.afterDown === true,
    at: new Date(n.created_at),
  });
}

/**
 * D-068 item 3 (spec §40.3): the ack of the expiry the new cause set aside — its acker is the person the
 * reply names (`mention.acked`, stored by `engine_new_cause_incident`).
 */
function setAsideOf(ctx: Record<string, unknown>): { by: string; at: Date } | null {
  const m = ctx.mention as { name?: unknown; acked?: unknown; ackedAt?: unknown } | undefined;
  const at = dateOf(m?.ackedAt);
  return m?.acked === true && typeof m.name === 'string' && at ? { by: m.name, at } : null;
}

/**
 * The expiry the incident was open for before this message's new cause, counted for `asOf` (D-068:
 * the email's "Was" row) — the newest event before it that carried an SSL / domain detail.
 */
function expiryBefore(i: IncidentFacts, before: Date, asOf: Date): string | null {
  // As times, not strings: Postgres writes "+00:00", a JS date "Z" (code review).
  const t = (at: string | null | undefined) => (at ? Date.parse(at) : Number.NaN);
  const events = [...(i.incident_events ?? [])]
    .filter((e) => t(e.at) < before.getTime())
    .sort((a, b) => t(a.at) - t(b.at));
  for (const e of events.reverse()) {
    const hit = expiryNow(contextOf(e.payload).detail, asOf);
    if (hit) return hit.cause;
  }
  return null;
}

/**
 * The FYI's Status (D-078): the newest note written at or before `asOf` (the message's queue time, so a
 * retry later doesn't show a note the first attempt couldn't have).
 */
export function latestNoteOf(i: IncidentFacts, asOf: Date): StatusNote | null {
  const t = (at: string | null | undefined) => (at ? Date.parse(at) : Number.NaN);
  let best: StatusNote | null = null;
  for (const e of i.incident_events ?? []) {
    if (e.type !== 'note') continue;
    const at = t(e.at);
    if (!(at <= asOf.getTime()) || (best && best.at.getTime() >= at)) continue;
    const p = contextOf(e.payload);
    if (typeof p.text !== 'string' || !p.text.trim()) continue;
    best = { text: p.text, by: typeof p.by === 'string' && p.by ? p.by : 'Someone', at: new Date(at) };
  }
  return best;
}

/** The RECOVERED card's "still SSL expiring" (D-068): whoever acts now — the acker, else L0. */
function stillOf(i: IncidentFacts, ctx: Record<string, unknown>, asOf: Date): StillExpiry | null {
  const still = stillExpiryOf(ctx, asOf);
  return still
    ? {
        ...still,
        incidentNumber: i.number,
        tier: i.sites.tier,
        mention:
          i.acked_at && i.acker
            ? { name: i.acker.display_name, chatUserId: i.acker.google_chat_user_id ?? null }
            : person(l0Of(i)),
      }
    : null;
}

/** D-068 (spec §40.2): back up, the incident still open for the expiry its DOWN joined. */
function stillExpiryOf(
  ctx: Record<string, unknown>,
  asOf: Date,
): { label: string; cause: string | null } | null {
  const still = ctx.stillExpiry as { trigger?: unknown; detail?: unknown } | undefined;
  const t = still?.trigger;
  // An unreadable detail still says what it stays open for (code review: never a plain "is back").
  return t === 'ssl' || t === 'domain'
    ? { label: TRIGGER_LABELS[t], cause: expiryNow(still?.detail, asOf)?.cause ?? null }
    : null;
}

/** D-067 (Tao, 17 Nov): the person on call a Tier 1 new cause at night names, stored with the row. */
function nightMention(ctx: Record<string, unknown>): ChatPerson | null {
  const m = ctx.mention as { name?: unknown; chatUserId?: unknown } | undefined;
  return m && typeof m.name === 'string'
    ? { name: m.name, chatUserId: typeof m.chatUserId === 'string' ? m.chatUserId : null }
    : null;
}

/** RESOLVED (D-033): who, when and the root cause, as `resolve_incident` stored them with the message. */
function resolvedOf(n: Notification, i: IncidentFacts) {
  const ctx = contextOf(n.context);
  const category = str(ctx.category, '');
  return {
    resolvedBy: str(ctx.resolvedBy, 'someone'),
    resolvedAt: dateOf(ctx.resolvedAt) ?? new Date(n.created_at),
    rootCause: (ROOT_CAUSE_CATEGORIES as readonly string[]).includes(category)
      ? ROOT_CAUSE_LABELS[category as RootCauseCategory]
      : category || 'Not given',
    whatHappened: str(ctx.what, ''),
    whatFixedIt: typeof ctx.fix === 'string' && ctx.fix ? ctx.fix : null,
    drops: closedDrops(i),
  };
}

/** How it was marked (S11): "marked by Bua 10:12" / "not needed · Tao 10:07"; null until marked. */
function clientUpdateWords(i: IncidentFacts): string | null {
  if (!i.client_update_required || !i.client_updated_at) return null;
  const by = i.client_updater?.display_name ?? 'someone';
  const at = formatTime(new Date(i.client_updated_at));
  return i.client_update_not_needed ? `not needed · ${by} ${at}` : `marked by ${by} ${at}`;
}

/**
 * The client-update record in words (S11, EmailAlert "Client update" rows): "Due 10:03 · Bua (AM)
 * notified — the AM sends it" while waiting, "Marked by Bua 10:12 — “Called MuvMi ops, ETA shared”",
 * "Not needed · Tao 10:07 — “<reason>”"; null when the track never fired.
 */
function clientUpdateFact(i: IncidentFacts): string | null {
  if (!i.client_update_required || !i.client_update_due_at) return null;
  const words = clientUpdateWords(i);
  if (words) {
    const head = `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
    return i.client_update_note ? `${head} — “${i.client_update_note}”` : head;
  }
  const am = i.sites.client?.am?.display_name;
  const due = formatTime(new Date(i.client_update_due_at));
  return am
    ? `Due ${due} · ${am} (AM) notified — the AM sends it`
    : `Due ${due} · no AM, the Admins were told`;
}

/** The RECOVERED card's line (ChatAlert): "Client update marked by Bua 10:12". */
function clientUpdateMarked(i: IncidentFacts): string | null {
  const words = clientUpdateWords(i);
  return words ? `Client update ${words}` : null;
}

/** The client-update email this reader got (S11): when it went, and whether it went to an Admin (no AM). */
function clientUpdateReaderOf(i: IncidentFacts, userId: string): { at: Date; noAm: boolean } | null {
  const e = i.incident_events?.find((x) => x.type === 'client_update_due');
  const p = e?.payload && typeof e.payload === 'object' ? (e.payload as Record<string, unknown>) : null;
  const ids = Array.isArray(p?.notified) ? p.notified : [];
  return e?.at && ids.includes(userId) ? { at: new Date(e.at), noAm: p?.noAm === true } : null;
}

/** The client the site belongs to; the site's name when it isn't loaded (an older facts query). */
const clientOf = (i: IncidentFacts) => i.sites.client?.name ?? i.sites.name;

/**
 * The cause line stored when the incident opened (its `detected` event). An SSL / domain PROBLEM's
 * days left are counted again for when the message goes (D-066 item 2).
 */
function causeOf(i: IncidentFacts, now: Date): string | null {
  const events = i.incident_events ?? [];
  // D-067: the cause the incident carries now — the newest of a new cause (or back to the expiry), a
  // PROBLEM AGAIN and a raise to DOWN, each words its own drop (message-checker: never the opening SSL
  // recounted after a renewal, never an old keyword after a DOWN). A DOWN AGAIN keeps the opening words.
  const last = [...events]
    .filter((e) => e.type === 'new_cause' || e.type === 'relapsed' || e.type === 'escalated_to_down')
    .sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''))
    .at(-1);
  const current =
    last && !(last.type === 'relapsed' && contextOf(last.payload).severity === 'down') ? last : undefined;
  const detected = current ?? events.find((e) => e.type === 'detected');
  const ctx = detected ? contextOf(detected.payload) : {};
  const manual = manualOf(ctx);
  if (manual) return manualCause(manual);
  // Counted to the recovery once it recovered (a renewed certificate never reads "expired 12 days ago").
  const asOf = i.recovered_at ? new Date(Math.min(now.getTime(), Date.parse(i.recovered_at))) : now;
  const expiry = expiryNow(ctx.detail, asOf);
  if (expiry) return expiry.cause;
  return typeof ctx.cause === 'string' ? ctx.cause : null;
}

/** The trigger a message was queued with (D-067: the incident's may have moved to a new cause since). */
function triggerOf(ctx: Record<string, unknown>, i: IncidentFacts): IncidentFacts['trigger'] {
  const t = ctx.trigger;
  return typeof t === 'string' && t in TRIGGER_LABELS ? (t as IncidentFacts['trigger']) : i.trigger;
}

/** "3 of 3 locations": where the problem was seen, of the locations reporting when it opened. */
function seenFrom(ctx: Record<string, unknown>): { count: number; of: number } | null {
  const detail = (ctx.detail ?? {}) as { locations?: unknown; location?: unknown };
  const count = Array.isArray(detail.locations) ? detail.locations.length : detail.location ? 1 : 0;
  const of = typeof ctx.reporting === 'number' ? ctx.reporting : 0;
  return count && of >= count ? { count, of } : null;
}

/** The mute's end on an incident's first alert after a mute (§24.7): "Held by a mute until 15:00". */
const heldUntilOf = (ctx: Record<string, unknown>) => (ctx.afterMute === true ? dateOf(ctx.heldUntil) : null);

/** A manual incident's L0 (S12b, spec §30.5): who opened it from the hand check and what they saw. */
const manualOf = (ctx: Record<string, unknown>) =>
  ctx.manual === true
    ? {
        openedBy: str(ctx.openedBy, 'Someone'),
        note: typeof ctx.note === 'string' ? ctx.note : null,
        // D-055 item 7: a PROBLEM raised to DOWN by hand.
        raised: ctx.raised === true,
      }
    : null;

/** Sent with Escalate now / the reminder by hand while the engine was stopped (D-055): who sent it. */
const byHandOf = (ctx: Record<string, unknown>) => (ctx.byHand === true ? str(ctx.sentBy, 'Someone') : null);

/** The Google Chat message for a claimed row, or null when its template has nothing to say. */
export function renderChat(n: Notification, i: IncidentFacts, appUrl: string, now: Date): ChatMessage | null {
  const ctx = contextOf(n.context);
  switch (n.template) {
    case 'down':
      return buildDownAlert({
        incidentId: i.id,
        incidentNumber: i.number,
        site: i.sites.name,
        tier: i.sites.tier,
        confirmedAt: new Date(i.detected_at),
        now,
        cause: str(ctx.cause, 'Hard fail'),
        confirmingLocations: num(ctx.confirmingLocations, 2),
        confirmedByWaf: confirmedByWafOf(ctx),
        owner: person(l0Of(i)),
        alsoMention: alsoL0(i),
        siteOwner: l0IsOnCall(i) ? person(i.sites.primary) : null,
        backup: person(i.sites.backup),
        // MobileAck: the card's link opens the incident ready to acknowledge.
        incidentUrl: `${incidentUrl(appUrl, i.id)}?ack=1`,
        // A PROBLEM someone acknowledged, raised to DOWN (D-021), isn't waiting on the ladder.
        ladder: i.state === 'acknowledged' ? null : ladderFactsOf(i, now),
        heldUntil: heldUntilOf(ctx),
        manual: manualOf(ctx),
      });
    case 'problem':
      return buildProblemAlert({
        incidentId: i.id,
        incidentNumber: i.number,
        site: i.sites.name,
        tier: i.sites.tier,
        trigger: triggerOf(ctx, i),
        detectedAt: new Date(i.detected_at),
        now,
        cause: str(ctx.cause, 'Problem'),
        summary: str(ctx.summary, 'problem'),
        seenFrom: seenFrom(ctx),
        verifier: typeof ctx.verifier === 'string' ? ctx.verifier : null,
        owner: person(l0Of(i)),
        alsoMention: alsoL0(i),
        siteOwner: l0IsOnCall(i) ? person(i.sites.primary) : null,
        backup: person(i.sites.backup),
        incidentUrl: `${incidentUrl(appUrl, i.id)}?ack=1`,
        ladder: ladderFactsOf(i, now),
        heldUntil: heldUntilOf(ctx),
      });
    case 'muted': {
      const until = dateOf(ctx.until);
      return until
        ? buildIncidentMutedLine({
            site: i.sites.name,
            incidentNumber: i.number,
            until,
            by: str(ctx.by, 'someone'),
            acked: ctx.acked === true,
            now,
          })
        : null;
    }
    case 'acknowledged':
      return buildAcknowledgedAlert({
        incidentId: i.id,
        site: i.sites.name,
        ackedBy: str(ctx.ackedBy, 'someone'),
        ackedAt: new Date(str(ctx.ackedAt, n.created_at)),
        problem: problemOf(i),
        stopped: stoppedOf(i, ctx),
      });
    case 'client_update_due':
      return buildClientUpdateDueAlert({
        incidentId: i.id,
        site: i.sites.name,
        tier: i.sites.tier,
        people: namedIn(i, n.context).mentioned,
        noAm: ctx.noAm === true,
        client: clientOf(i),
        // Fired in the minute it recovered (a DOWN drop covered the due time): "was down".
        recovered: i.state === 'monitoring' || i.state === 'needs_root_cause',
        draftUrl: `${incidentUrl(appUrl, i.id)}#client-update`,
        byHand: byHandOf(ctx),
      });
    case 'step_fired': {
      const named = namedIn(i, n.context);
      const step = stepFactsOf(i, n.context);
      return buildStepAlert({
        byHand: byHandOf(ctx),
        incidentId: i.id,
        site: i.sites.name,
        severity: ctx.severity === 'problem' ? 'problem' : 'down',
        level: num(ctx.level, 1),
        elapsedMin: num(ctx.elapsedMin, 15),
        owner: person(l0Of(i)),
        asked: named.asked,
        fyi: named.fyi,
        // L1 · night: the backup on call was paged at L0, so L1 asks only the Admin (ChatAlert).
        alreadyPaged:
          num(ctx.level, 1) === 1 && l0IsOnCall(i) && i.sites.backup?.id === l0Of(i)?.id
            ? (l0Of(i)?.display_name ?? null)
            : null,
        incidentUrl: `${incidentUrl(appUrl, i.id)}?ack=1`,
        viewUrl: incidentUrl(appUrl, i.id),
        kind: step.kind,
        // A level promised only while nobody has acknowledged (an ack stops it, §14.1).
        next: i.state === 'acknowledged' || byHandOf(ctx) ? null : step.next,
        informed: step.informed,
        informedRoles: step.informedRoles,
        fyiNext: step.fyiNext,
        acked: step.acked,
        ...(step.kind === 'fyi'
          ? {
              cause: causeOf(i, new Date(n.created_at)),
              since: downSinceOf(i),
              status: latestNoteOf(i, new Date(n.created_at)),
              sentAt: new Date(n.created_at),
            }
          : {}),
      });
    }
    case 'reminder':
      return buildReminderAlert({
        incidentId: i.id,
        site: i.sites.name,
        severity: ctx.severity === 'problem' ? 'problem' : 'down',
        elapsedMin: num(ctx.elapsedMin, num(ctx.afterMin, 30)),
        mention: namedIn(i, n.context).mentioned,
        incidentUrl: `${incidentUrl(appUrl, i.id)}?ack=1`,
      });
    case 'recovered': {
      const drop = recoveryOf(i, ctx);
      if (!drop) return null;
      if (ctx.autoResolved === true) {
        return buildAutoResolvedAlert({
          incidentId: i.id,
          site: i.sites.name,
          flaggedAt: new Date(i.detected_at),
          recoveredAt: drop.end,
          okLocations: num(ctx.okLocations, 2),
          problem: problemOf(i, ctx) ?? { trigger: i.trigger },
          keyPage: keyPageOf(openedWith(i).keyPage),
        });
      }
      return buildRecoveredAlert({
        incidentId: i.id,
        site: i.sites.name,
        startedAt: drop.start,
        recoveredAt: drop.end,
        okLocations: num(ctx.okLocations, 2),
        owner: person(l0Of(i)),
        problem: dropProblem(i, drop, ctx),
        clientUpdate: clientUpdateMarked(i),
        stillExpiry: stillOf(i, ctx, now),
      });
    }
    case 'down_again':
    case 'problem_again':
      // D-067: a new cause rides problem_again (its SQL lists), marked in the context.
      return ctx.newCause === true ? newCauseAlert(n, i) : againAlert(n, i, now);
    case 'note':
      return buildNoteAlert({ site: i.sites.name, by: str(ctx.by, 'someone'), text: str(ctx.text, '') });
    case 'resolved':
      return buildResolvedAlert({ incidentId: i.id, site: i.sites.name, ...resolvedOf(n, i) });
    case 'flap_summary': {
      const drops = closedDrops(i);
      return drops.length
        ? buildFlapSummaryAlert({
            incidentId: i.id,
            site: i.sites.name,
            severity: summarySeverity(i),
            owner: person(l0Of(i)),
            drops,
          })
        : null;
    }
    default:
      return null;
  }
}

/**
 * Why this person gets the email (the footer line): the one who acknowledged, the owner, everyone
 * already emailed for RESOLVED (D-033), or — for everyone else — because a Chat alert of the incident
 * couldn't be delivered (D-016).
 */
export function emailReason(n: Notification, i: IncidentFacts): EmailReason {
  if (n.template === 'acknowledged' && contextOf(n.context).ackedById === n.user_id) return 'acked';
  // A step's own email (its people); the Chat fallback goes to the backup and Admins (D-016).
  if (n.template === 'step_fired') return contextOf(n.context).fallback === true ? 'fallback' : 'step';
  // A Tier 1 new cause at night: the person on call it named (D-067).
  const mention = contextOf(n.context).mention as { id?: unknown } | undefined;
  if (n.user_id && n.template === 'problem_again' && mention?.id === n.user_id)
    return setAsideOf(contextOf(n.context)) ? 'acked' : 'oncall';
  if (l0Of(i)?.id === n.user_id) return l0IsOnCall(i) ? 'oncall' : 'owner';
  // …and their later emails (RECOVERED, RESOLVED): emailed about it, nothing asked of them — the owner
  // adds the root cause (message-checker). The new cause's event says whom it told.
  const told = (i.incident_events ?? []).some(
    (e) =>
      e.type === 'new_cause' &&
      (contextOf(e.payload).mention as { id?: unknown } | undefined)?.id === n.user_id,
  );
  if (n.user_id && told) return 'emailed';
  // Anyone a step told (the Tier 1 FYI's CEO and AM): their RECOVERED / flap summary is the "email when
  // it's back" the FYI promised (D-078), not a Chat fallback.
  const stepped = (i.incident_events ?? []).some((e) => {
    if (e.type !== 'step_fired') return false;
    const notified = contextOf(e.payload).notified;
    return Array.isArray(notified) && notified.includes(n.user_id);
  });
  if (n.user_id && stepped) return 'emailed';
  // Someone the L0 pencil adds (S10): told at once by email too, then followed up like anyone emailed.
  if (n.user_id && l0PeopleOf(i).includes(n.user_id)) return L0_TEMPLATES.has(n.template) ? 'l0' : 'emailed';
  if (n.template === 'resolved') return 'emailed';
  return 'fallback';
}

/** The email for a claimed row and its recipient, or null when its template has nothing to say. */
export function renderEmail(
  n: Notification,
  i: IncidentFacts,
  to: Recipient,
  appUrl: string,
  thread: { threadId: string; startsThread: boolean },
): EmailMessage | null {
  const ctx = contextOf(n.context);
  // When it goes out: "acknowledge by 10:03" reads as a time today or tomorrow.
  const sentAt = new Date(n.hold_until ?? n.created_at);
  // D-047: an ack releases the alert email held for its grace, so it can go after the ack.
  const acknowledged =
    ctx.escalated !== true && i.acker && i.acked_at
      ? { by: i.acker.display_name, at: new Date(i.acked_at) }
      : null;
  const base: EmailBaseInput = {
    incidentId: i.id,
    incidentNumber: i.number,
    site: i.sites.name,
    tier: i.sites.tier,
    recipientId: to.id,
    reason: emailReason(n, i),
    incidentUrl: incidentUrl(appUrl, i.id),
    ...thread,
  };
  // S11 (EmailAlert Bua rows): someone emailed the client update gets its footer, not "fallback".
  const cuReader = n.template === 'client_update_due' ? null : clientUpdateReaderOf(i, to.id);
  if (cuReader && base.reason === 'fallback') {
    base.reason = 'step';
    base.why =
      n.template === 'recovered' && i.client_updated_at && !i.client_update_not_needed && !cuReader.noAm
        ? `You got this because you’re the AM for ${clientOf(i)} and handled its client update.`
        : `You got this because you were emailed about the client update at ${formatTime(cuReader.at)}.`;
  }
  const amReader = cuReader
    ? {
        marked: i.client_updated_at ? formatTime(new Date(i.client_updated_at)) : null,
        // "Not needed" is no update the AM sent (message-check M1): said as such, with who and when.
        notNeeded:
          i.client_updated_at && i.client_update_not_needed
            ? `${plainName(i.client_updater?.display_name ?? 'someone')} ${formatTime(new Date(i.client_updated_at))}`
            : null,
        draftUrl: `${incidentUrl(appUrl, i.id)}#client-update`,
      }
    : null;
  switch (n.template) {
    case 'down':
      return buildDownEmail({
        ...base,
        confirmedAt: new Date(i.detected_at),
        cause: str(ctx.cause, 'Hard fail'),
        confirmingLocations: num(ctx.confirmingLocations, 2),
        confirmedByWaf: confirmedByWafOf(ctx),
        // A PROBLEM raised to DOWN keeps its acknowledgement (D-021) — only then: a plain DOWN acked
        // inside its 5-min email grace sends this email after the ack (D-047), and it never was a problem.
        ackedBy:
          ctx.escalated === true && i.state === 'acknowledged' && i.acker ? i.acker.display_name : null,
        ladder: ladderFactsOf(i, sentAt),
        now: sentAt,
        // The first alert after a mute (§24.17): "Held by a mute — until 15:00 — …".
        heldUntil: heldUntilOf(ctx),
        acknowledged,
        manual: manualOf(ctx),
      });
    case 'problem':
      return buildProblemEmail({
        ...base,
        trigger: triggerOf(ctx, i),
        detectedAt: new Date(i.detected_at),
        cause: str(ctx.cause, 'Problem'),
        summary: str(ctx.summary, 'problem'),
        verifier: typeof ctx.verifier === 'string' ? ctx.verifier : null,
        ladder: ladderFactsOf(i, sentAt),
        now: sentAt,
        heldUntil: heldUntilOf(ctx),
        acknowledged,
      });
    case 'client_update_due': {
      const dueAt = new Date(str(ctx.dueAt, n.created_at));
      return buildClientUpdateDueEmail({
        ...base,
        reason: 'step',
        client: clientOf(i),
        confirmedAt: new Date(i.detected_at),
        // From the first failed check (D-002): 15 min on Tier 1; a Tier 2 night counts the wall clock.
        // By hand it can go before it fell due (D-055 item 3): how long it was down when it was sent.
        downMinutes: clockMinutes(new Date(i.started_at), byHandOf(ctx) ? new Date(n.created_at) : dueAt),
        cause: causeOf(i, sentAt),
        acked: i.acker && i.acked_at ? { by: i.acker.display_name, at: new Date(i.acked_at) } : null,
        noAm: ctx.noAm === true,
        draftUrl: `${incidentUrl(appUrl, i.id)}#client-update`,
        dueAt,
        recovered: i.state === 'monitoring' || i.state === 'needs_root_cause',
        byHand: byHandOf(ctx),
      });
    }
    case 'step_fired': {
      const asFyi = ctx.asFyi === true;
      const level = num(ctx.level, 1);
      const step = stepFactsOf(i, n.context);
      return buildStepEmail({
        ...base,
        byHand: byHandOf(ctx),
        why: stepWhy(i, to.id, level, asFyi, step.kind),
        kind: step.kind,
        readerIs: readerOf(i, to.id),
        informed: step.informed,
        informedRoles: step.informedRoles,
        alreadyTold: byHandOf(ctx) ? null : step.alreadyTold,
        admin: step.admin,
        acked: step.acked,
        stopped: step.stopped,
        nextStep: byHandOf(ctx) ? null : step.nextStep,
        fyiNext: step.fyiNext,
        voiceConfigured: step.voiceConfigured,
        severity: ctx.severity === 'problem' ? 'problem' : 'down',
        level,
        elapsedMin: num(ctx.elapsedMin, 15),
        // When it was queued: after a relapse the elapsed minutes are the down minutes only (D-058).
        sentAt: new Date(n.created_at),
        downAgainAt: againAtOf(i, ctx.severity === 'problem' ? 'problem' : 'down'),
        // The FYI's "confirmed down" is the DOWN's own confirmation, not a PROBLEM before it (D-021, D-078).
        confirmedAt: step.kind === 'fyi' ? downSinceOf(i) : new Date(i.detected_at),
        owner: l0Of(i)?.display_name ?? null,
        asFyi,
        asked: namedIn(i, n.context).askedNames.join(' and ') || null,
        cause: causeOf(i, sentAt),
        toldAt: toldAtOf(i),
        fallback: ctx.fallback === true,
        clientUpdate: step.kind === 'fyi' ? clientUpdateFact(i) : null,
        status: step.kind === 'fyi' ? latestNoteOf(i, new Date(n.created_at)) : null,
      });
    }
    case 'acknowledged':
      return buildAcknowledgedEmail({
        ...base,
        problem: problemOf(i),
        cause: causeOf(i, sentAt),
        ackedBy: str(ctx.ackedBy, 'someone'),
        ackedAt: new Date(str(ctx.ackedAt, n.created_at)),
        startedAt: new Date(i.started_at),
        downMinutes: outageAt(i, new Date(str(ctx.ackedAt, n.created_at))),
        confirmedAt: new Date(i.detected_at),
        stopped: stoppedOf(i, ctx),
        clientUpdate: clientUpdateFact(i),
        amReader,
      });
    case 'recovered': {
      const drop = recoveryOf(i, ctx);
      if (!drop) return null;
      if (ctx.autoResolved === true) {
        return buildAutoResolvedEmail({
          ...base,
          trigger: i.trigger,
          flaggedAt: new Date(i.detected_at),
          recoveredAt: drop.end,
          cause: causeOf(i, sentAt),
          keyPage: keyPageOf(openedWith(i).keyPage),
        });
      }
      return buildRecoveredEmail({
        ...base,
        startedAt: drop.start,
        recoveredAt: drop.end,
        okLocations: num(ctx.okLocations, 2),
        owner: l0Of(i)?.display_name ?? null,
        ack: i.acked_at && i.acker ? { by: i.acker.display_name, at: new Date(i.acked_at) } : null,
        problem: dropProblem(i, drop, ctx),
        clientUpdate: clientUpdateFact(i),
        amReader,
        amName: i.sites.client?.am?.display_name ?? null,
        stillExpiry: stillExpiryOf(ctx, sentAt),
      });
    }
    case 'resolved':
      return buildResolvedEmail({ ...base, ...resolvedOf(n, i) });
    case 'flap_summary': {
      const drops = closedDrops(i);
      return drops.length
        ? buildFlapSummaryEmail({
            ...base,
            severity: summarySeverity(i),
            drops,
            owner: l0Of(i)?.display_name ?? null,
            ack: i.acked_at && i.acker ? { by: i.acker.display_name, at: new Date(i.acked_at) } : null,
            pausedUntil: i.acked_at ? null : (ladderFactsOf(i, sentAt)?.pausedUntil ?? null),
          })
        : null;
    }
    // The D-016 fallback when the Chat reply failed, or (D-047) the owner's first email: the reply's words.
    case 'down_again':
    case 'problem_again': {
      // D-067: a new cause rides problem_again (its SQL lists) and has its own email — not an AGAIN.
      if (ctx.newCause === true) {
        return buildNewCauseEmail({
          ...base,
          now:
            TRIGGER_LABELS[(typeof ctx.trigger === 'string' ? ctx.trigger : i.trigger) as Trigger] ??
            'Problem',
          was: TRIGGER_LABELS[str(ctx.was, 'ssl') as Trigger] ?? 'SSL expiring',
          cause: str(ctx.cause, 'Problem'),
          summary: typeof ctx.summary === 'string' ? ctx.summary : null,
          wasCause: expiryBefore(i, new Date(n.created_at), sentAt),
          at: new Date(n.created_at),
          openedAt: new Date(i.detected_at),
          acknowledged,
          // Only the acker's own email (message-checker M2: a fallback copy goes to the backup and Admins).
          setAside: acknowledged || base.reason !== 'acked' ? null : setAsideOf(ctx),
          afterDown: ctx.afterDown === true,
        });
      }
      const chat = againAlert(n, i);
      const card = chat.cardsV2[0]!.card;
      const body = card.sections[0]?.widgets[0];
      return buildAgainEmail({
        ...base,
        severity: n.template === 'down_again' ? 'down' : 'problem',
        title: card.header.title,
        body: body && 'textParagraph' in body ? body.textParagraph.text.replace(/&lt;/g, '<') : '',
        acknowledged,
      });
    }
    default:
      return null;
  }
}

const VERIFIER_DOWN_REASONS: readonly VerifierDownReason[] = ['no_poll', 'not_picked_up', 'lease_expired'];

/** The Admin alert email for a claimed row (D-019), or null for a kind it doesn't know. */
export function renderSystemAlertEmail(
  n: Notification,
  alert: SystemAlertFacts,
  from: string,
  /** The app's base URL, for "Open Probes & heartbeat" (S12a); without it the email has no button. */
  appUrl?: string,
): EmailMessage | null {
  const ctx = contextOf(alert.context);
  const sites = Array.isArray(ctx.sites) ? ctx.sites.filter((s): s is string => typeof s === 'string') : [];
  const reason = VERIFIER_DOWN_REASONS.find((r) => r === ctx.reason);
  const active = Array.isArray(ctx.active)
    ? PROBE_LOCATIONS.filter((l: ProbeLocation) => (ctx.active as unknown[]).includes(l))
    : [];
  switch (n.template) {
    case 'verifier_unavailable':
    case 'verifier_backlog':
    case 'probe_locations_low':
    case 'bkk_control_failing':
    case 'probe_location_missing':
      if (n.template === 'probe_location_missing' && !PROBE_LOCATIONS.includes(ctx.location as ProbeLocation))
        return null;
      return buildSystemAlertEmail({
        alertId: alert.id,
        kind: n.template,
        openedAt: new Date(alert.opened_at),
        sites,
        reason,
        queued: num(ctx.queued, 0),
        active,
        location: PROBE_LOCATIONS.find((l: ProbeLocation) => l === ctx.location),
        lastBeatAt: typeof ctx.lastBeatAt === 'string' ? new Date(ctx.lastBeatAt) : undefined,
        probesUrl: appUrl ? `${appUrl.replace(/\/$/, '')}/probes` : undefined,
        from,
      });
    default:
      return null;
  }
}
