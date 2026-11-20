import { CLIENT_UPDATE_MIN } from '@dxt/engine';
import {
  TIER_CONFIG,
  formatDay,
  formatPercent,
  type EscalationChannel,
  type EscalationStep,
  type EscalationTarget,
  type IncidentState,
  type SiteStatus,
} from '@dxt/shared';
import { GUIDE_ROLES, type GuideLayout, type TopicLike } from './model';

/**
 * The User guide's topics (boards Guide, MGuide; spec §18), written from the decisions rather than
 * the boards' 25 Sep copy (D-070): every value that can change — the response hours, the ladder, who is
 * on call, how many Admins — comes from `GuideFacts`, read live. The boards' sample people and
 * incidents never appear.
 */

export type PolicyKey = 't1' | 't2' | 't3' | 'problem';

/** One on-call shift, for the rotation topic. */
export interface GuideShift {
  who: string;
  startsAt: string;
  endsAt: string;
}

/** What the guide reads live (queries.ts). */
export interface GuideFacts {
  /** "Mon–Fri 09:00–18:00" (organisation settings, D-069). */
  hours: string;
  tier1Sites: number;
  /** Every active Admin's name. */
  admins: string[];
  onCallNow: GuideShift | null;
  /** The next shifts after the live one, soonest first. */
  onCallNext: GuideShift[];
  policies: Record<PolicyKey, EscalationStep[]>;
  downReminderMin: number;
  problemReminderMin: number;
  /** Admin-only links (Audit log, Settings) are left out for everyone else. */
  isAdmin: boolean;
}

/** Icon names the components map to AURA icons. */
export type GuideIcon =
  | 'lock'
  | 'bell'
  | 'circle-check'
  | 'circle-alert'
  | 'mail'
  | 'pencil'
  | 'monitor'
  | 'eye-off'
  | 'users'
  | 'chart-column'
  | 'settings'
  | 'arrow-up-right'
  | 'user'
  | 'calendar'
  | 'file-text'
  | 'layout-dashboard';

export interface Bullet {
  lead: string;
  text: string;
}
export interface Callout {
  tone: 'info' | 'warning';
  title: string;
  text: string;
}
export interface Step {
  title: string;
  text: string;
  /** A badge beside the title (the resolve steps). */
  badge?: IncidentState;
  /** Badges shown as a flow under the text (Unacked → Escalated → Acknowledged). */
  flow?: IncidentState[];
  /** A line in mono, as Chat shows it. */
  mono?: string;
  /** The held-action toast, drawn (never live). */
  toast?: { title: string; line: string; undo: string };
  /** The resolve gate's three conditions, and what follows it. */
  gates?: { t: string; d: string }[];
  after?: string;
}
export interface LadderRow {
  level: string;
  when: string;
  who: string;
  ack: string;
  /** The FYI step's "after ack" words stand out. */
  fyi: boolean;
}

export type Block =
  | { kind: 'bullets'; items: Bullet[] }
  | { kind: 'steps'; items: Step[] }
  | { kind: 'checklist'; title: string; items: string[] }
  | { kind: 'callout'; callout: Callout }
  | {
      kind: 'ladder';
      title: string;
      note: string;
      rows: LadderRow[];
      cards: { title: string; text: string }[];
    }
  | { kind: 'lifecycle'; states: IncidentState[]; note: string }
  | { kind: 'compare'; rows: { k: string; mute: string; maint: string }[] }
  | { kind: 'siteStates'; rows: { status: SiteStatus; muted?: boolean; text: string }[] }
  | { kind: 'incidentStates'; rows: { state: IncidentState; text: string }[] }
  | { kind: 'glyphs' }
  | { kind: 'matrix' };

export interface RelatedLink {
  label: string;
  href: string;
  icon: GuideIcon;
}

export interface Topic extends TopicLike {
  icon: GuideIcon;
  summary: string;
  lede: string;
  blocks: Block[];
  /** Screens (desktop "Related screens"; the phone's open button is the first). */
  related: RelatedLink[];
  /** Other topics (the phone's "Related"). */
  relatedTopics: string[];
}

// ── Words from the facts ───────────────────────────────────────────────────

const TARGET_ORDER: readonly EscalationTarget[] = ['owner', 'backup', 'admins', 'ceo', 'site_am'];

/** A step's people in the guide's words: the Admin token names every active Admin (D-034). */
const TARGET_WORDS: Record<EscalationTarget, string> = {
  owner: 'owner',
  backup: 'backup',
  admins: 'every Admin',
  ceo: 'CEO',
  site_am: 'site AM',
};

const CHANNEL_WORDS: Record<Exclude<EscalationChannel, 'voice'>, string> = {
  chat: 'Chat @mention',
  space: 'Alerts Space',
  email: 'email',
};

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/** "backup + every Admin". */
function whoOf(s: EscalationStep, owner = TARGET_WORDS.owner): string {
  const names = TARGET_ORDER.filter((t) => s.targets.includes(t)).map((t) =>
    t === 'owner' ? owner : TARGET_WORDS[t],
  );
  return names.join(' + ') || 'nobody';
}

/** "Chat @mention + email" — voice is configured but off until approved (D-009). */
function channelsOf(s: EscalationStep): string {
  const words = s.channels.flatMap((c) => (c === 'voice' ? [] : [CHANNEL_WORDS[c]]));
  const voice = s.channels.includes('voice') ? ' (voice call off until approved)' : '';
  return `${words.join(' + ')}${voice}`;
}

const whenOf = (s: EscalationStep) => (s.level === 0 ? '0 min' : `+${s.delayMin} min`);

/** The Tier 1 DOWN ladder as rows (Guide "Who gets it if nobody acknowledges"). */
export function ladderRows(steps: readonly EscalationStep[]): LadderRow[] {
  return steps.map((s) => ({
    level: `L${s.level}`,
    when: whenOf(s),
    who: `${cap(whoOf(s, 'owner inside response hours, on-call outside'))} · ${channelsOf(s)}`,
    ack:
      s.level === 0
        ? 'Chat at once, email after 5 min'
        : s.fyi
          ? 'Also after an ack: FYI, no call'
          : 'Stopped by ack',
    fyi: !!s.fyi,
  }));
}

/** "L0 owner · L1 +15 min backup + every Admin · L2 +30 min every Admin" (a policy in one line). */
export function policyLine(steps: readonly EscalationStep[]): string {
  return steps.map((s) => `L${s.level}${s.level ? ` ${whenOf(s)}` : ''} ${whoOf(s)}`).join(' · ');
}

const sameSteps = (a: readonly EscalationStep[], b: readonly EscalationStep[]) =>
  JSON.stringify(a) === JSON.stringify(b);

/** The first level at which Admins are paged on a policy, if any. */
function adminLevel(steps: readonly EscalationStep[]): number | null {
  return steps.find((s) => s.targets.includes('admins'))?.level ?? null;
}

function shiftWords(s: GuideShift): string {
  const day = (iso: string) => formatDay(new Date(iso), { weekday: true });
  return `${s.who} (${day(s.startsAt)} → ${day(s.endsAt)})`;
}

const B = (lead: string, text: string): Bullet => ({ lead, text });

// ── The topics ─────────────────────────────────────────────────────────────

const EVERYONE = GUIDE_ROLES;

interface Draft extends Omit<Topic, 'text'> {
  keywords: string;
}

/** Every string a topic shows, for search. */
function textOf(d: Draft): string {
  const parts: string[] = [d.title, d.summary, d.keywords, d.lede];
  for (const b of d.blocks) {
    switch (b.kind) {
      case 'bullets':
        b.items.forEach((x) => parts.push(x.lead, x.text));
        break;
      case 'steps':
        b.items.forEach((x) =>
          parts.push(x.title, x.text, x.mono ?? '', ...(x.gates ?? []).flatMap((g) => [g.t, g.d])),
        );
        break;
      case 'checklist':
        parts.push(b.title, ...b.items);
        break;
      case 'callout':
        parts.push(b.callout.title, b.callout.text);
        break;
      case 'ladder':
        parts.push(
          b.title,
          b.note,
          ...b.rows.flatMap((r) => [r.level, r.who, r.ack]),
          ...b.cards.flatMap((c) => [c.title, c.text]),
        );
        break;
      case 'lifecycle':
        parts.push(b.note);
        break;
      case 'compare':
        b.rows.forEach((r) => parts.push(r.k, r.mute, r.maint));
        break;
      case 'siteStates':
      case 'incidentStates':
        b.rows.forEach((r) => parts.push(r.text));
        break;
      default:
        break;
    }
  }
  return parts.join(' ');
}

function finish(d: Draft): Topic {
  const { keywords: _keywords, ...rest } = d;
  return { ...rest, text: textOf(d) };
}

const LINKS = {
  overview: { label: 'Overview', href: '/', icon: 'layout-dashboard' },
  incidents: { label: 'Incidents', href: '/incidents', icon: 'bell' },
  escalation: { label: 'Escalation policies', href: '/escalation', icon: 'arrow-up-right' },
  maintenance: { label: 'Maintenance & mutes', href: '/maintenance', icon: 'calendar' },
  oncall: { label: 'On-call rotation', href: '/oncall', icon: 'users' },
  profile: { label: 'My profile', href: '/profile', icon: 'user' },
  probes: { label: 'Probes & heartbeat', href: '/probes', icon: 'monitor' },
  sites: { label: 'Sites', href: '/sites', icon: 'monitor' },
  audit: { label: 'Audit log', href: '/audit', icon: 'file-text' },
  users: { label: 'Users & roles', href: '/settings/users', icon: 'users' },
  security: { label: 'Sign-in & security', href: '/settings/security', icon: 'lock' },
  channels: { label: 'Alert channels', href: '/settings/alert-channels', icon: 'bell' },
  organisation: { label: 'Organisation', href: '/settings/organisation', icon: 'settings' },
} satisfies Record<string, RelatedLink>;

const ADMIN_ONLY = new Set<string>([
  LINKS.audit.href,
  LINKS.users.href,
  LINKS.security.href,
  LINKS.channels.href,
  LINKS.organisation.href,
]);

/** Only Admins get one-Admin warnings' "Add a second Admin" wording; everyone else is told to ask one. */
function oneAdminCallout(f: GuideFacts, what: string): Callout | null {
  if (f.admins.length !== 1) return null;
  return {
    tone: 'warning',
    title: 'Only one active Admin',
    text: `${what} reach ${f.admins[0]} only. ${f.isAdmin ? 'Add a second Admin in Settings › Users.' : 'Ask an Admin to add a second one.'}`,
  };
}

function drafts(f: GuideFacts): Draft[] {
  const t1 = f.policies.t1;
  const fyi = t1.find((s) => s.fyi);
  const t1Admins = adminLevel(t1);
  const updT1 = CLIENT_UPDATE_MIN[1] ?? 15;
  const updT2 = CLIENT_UPDATE_MIN[2] ?? 60;
  const tierCards = sameSteps(f.policies.t2, f.policies.t3)
    ? [{ title: 'Tier 2–3 DOWN', steps: f.policies.t2 }]
    : [
        { title: 'Tier 2 DOWN', steps: f.policies.t2 },
        { title: 'Tier 3 DOWN', steps: f.policies.t3 },
      ];

  const signin: Draft = {
    id: 'signin',
    group: 'Getting started',
    icon: 'lock',
    title: 'Sign in & 2-step',
    summary: 'Your company Google account · Google requires 2-step',
    keywords: 'login google account 2sv two-step verification access list session device sign out',
    roles: EVERYONE,
    lede: 'Sign in with your company Google account. An Admin adds you to the access list first, and Google itself requires 2-step verification.',
    blocks: [
      {
        kind: 'bullets',
        items: [
          B(
            'Your company Google account.',
            'Use its primary company address. Accounts outside the company’s Google organisation can’t reach the sign-in page.',
          ),
          B(
            'An Admin adds you first.',
            'Only addresses on the access list get in. No access yet? Ask an Admin to add you, then sign in again.',
          ),
          B(
            '2-step is Google’s, not ours.',
            'Google requires 2-step verification on company accounts. Your Google Account › 2-Step Verification page should say it’s required and can’t be turned off — if you can turn it off, tell an Admin.',
          ),
          B(
            'You stay signed in on this device,',
            'so the link in an alert opens straight to the incident. Sign out other devices from My profile — it takes effect at once.',
          ),
          B(
            'Signing in is how DxT Monitor knows who acted.',
            'Every acknowledgement, note and resolve is recorded under your own account.',
          ),
        ],
      },
    ],
    related: [LINKS.profile, LINKS.security],
    relatedTopics: ['phone', 'alert'],
  };

  const phone: Draft = {
    id: 'phone',
    group: 'Getting started',
    icon: 'bell',
    title: 'Set up your phone for on-call',
    summary: '3 checks so a night alert actually wakes you',
    keywords: 'phone mobile do not disturb dnd notify mentions test alert checklist night',
    roles: ['Responder', 'On-call', 'Admin'],
    lede: `Outside response hours (${f.hours}), Tier 1 alerts (${f.tier1Sites} ${f.tier1Sites === 1 ? 'site' : 'sites'}) go to the person on call through Google Chat. Three checks decide whether your phone rings.`,
    blocks: [
      {
        kind: 'checklist',
        title: 'ON-CALL CHECKLIST · ALL 3 NEEDED',
        items: [
          'Alerts Space: notify for @mentions only',
          'Space allowed through Do Not Disturb',
          'Test alert received on this phone',
        ],
      },
      {
        kind: 'bullets',
        items: [
          B(
            'Send yourself a test',
            'from My profile or your card on On-call. It posts in its own “TEST — no action” thread and mentions only you.',
          ),
          B(
            'Open the test on the phone you carry.',
            'Opening its link there ticks the third check. A test opened on an old phone doesn’t count — send a new one after changing phones.',
          ),
          B(
            '@mentions are what ring.',
            'The text line above each card @mentions the person expected to act; names inside the card don’t notify.',
          ),
          B('No personal do-not-disturb in the app.', 'DOWN always reaches whoever is expected to act.'),
        ],
      },
    ],
    related: [LINKS.profile, LINKS.oncall],
    relatedTopics: ['rotation', 'alert'],
  };

  const statuses: Draft = {
    id: 'statuses',
    group: 'Getting started',
    icon: 'circle-check',
    title: 'Statuses & badges',
    summary: 'OK, Problem, Down, Maintenance, Muted and the incident states',
    keywords:
      'status badge colour color ok problem down maintenance muted unacked escalated acknowledged monitoring resolved legend bkk sin tyo glyph',
    roles: EVERYONE,
    lede: 'Two kinds of badge: site status says how the site is right now; incident state says where the response is. Every badge has an icon and a word.',
    blocks: [
      {
        kind: 'siteStates',
        rows: [
          {
            status: 'ok',
            text: 'Reachable. Most locations pass — or bot protection blocked the check and the browser verifier loaded the page (shown with a note).',
          },
          {
            status: 'problem',
            text: 'Reachable, with an issue: Slow, Keyword, Key page, Regional, Intermittent, TLS chain error, SSL or domain expiring, Page change, Blocked, not verified… Counts as up in uptime.',
          },
          {
            status: 'down',
            text: 'At least 2 of 3 locations hard-fail (timeout, 5xx, DNS or TLS error, connection refused) on two checks in a row — the second is an immediate recheck about 30 s later.',
          },
          {
            status: 'maintenance',
            text: 'Inside a planned window. Alerts held, the window not counted in uptime.',
          },
          {
            status: 'ok',
            muted: true,
            text: 'Mute is an overlay, not a status — the real status stays next to it.',
          },
        ],
      },
      {
        kind: 'incidentStates',
        rows: [
          { state: 'unacked', text: 'Not acknowledged yet, before L1 fires.' },
          {
            state: 'escalated',
            text: 'A later level paged someone new and nobody has acknowledged. The wait shows as text (“18 min unacked”).',
          },
          { state: 'acknowledged', text: 'Someone acknowledged; the site may still be failing.' },
          { state: 'monitoring', text: 'First OK round after recovery — RECOVERED sent.' },
          {
            state: 'needs_root_cause',
            text: '2 OK rounds done; the root cause (or a required client update) is missing.',
          },
          { state: 'resolved', text: 'All 3 conditions met and someone pressed Resolve.' },
        ],
      },
      { kind: 'glyphs' },
      {
        kind: 'callout',
        callout: {
          tone: 'info',
          title: 'Read the icon and the word, not just the colour',
          text: 'Solid red with the ban icon always means the site is DOWN right now. Incident states are always outlined and never use it. Among badges, purple means Maintenance only — look for the calendar icon.',
        },
      },
    ],
    related: [LINKS.incidents, LINKS.sites],
    relatedTopics: ['alert', 'resolve'],
  };

  const alert: Draft = {
    id: 'alert',
    group: 'When things go wrong',
    icon: 'circle-alert',
    title: 'When an alert arrives',
    summary: 'Acknowledge in one tap · who gets it if nobody acks',
    keywords:
      'ack acknowledge alert escalation ladder l0 l1 l2 l3 undo chat email ceo fyi timers response hours reminder still down',
    roles: ['Responder', 'On-call', 'Stakeholder', 'Admin'],
    lede: 'Open the card, acknowledge in one tap, then work the incident. Nothing is posted until the 10 s undo window closes.',
    blocks: [
      {
        kind: 'callout',
        callout: {
          tone: 'info',
          title: 'For Stakeholders (AMs, CEO)',
          text: 'Got an FYI or a client-update mention? You can’t acknowledge, and you don’t need to — AMs act on the client update; the CEO needs no action on an FYI.',
        },
      },
      {
        kind: 'steps',
        items: [
          {
            title: 'Open the card',
            text: `The text line above the Chat card @mentions the person expected to act — the owner inside response hours (${f.hours}), the person on call outside them for Tier 1. Tap Open / acknowledge, or open the email.`,
            mono: '@owner DOWN · Site name (Tier 1) · acknowledge by 10:03 or it escalates',
          },
          {
            title: 'Acknowledge in one tap',
            text: 'Admins, and Responders on sites they own or back up (and on Tier 1 while on call), can acknowledge. The ack is recorded under your own Google account, so nobody can acknowledge as someone else. The state changes from Unacked (or Escalated) to Acknowledged:',
            flow: ['unacked', 'escalated', 'acknowledged'],
          },
          {
            title: 'Tapped by mistake? Undo within 10 s',
            text: 'Nothing leaves the app until the undo window closes. For 10 s you see:',
            toast: {
              title: 'Acknowledged',
              line: 'Posting to Chat and email in 8 s — nothing is sent until then',
              undo: 'Undo · 8 s',
            },
          },
          {
            title: 'Work the incident',
            text: 'The cause line shows where it failed — “Timeout > 30 s (BKK, TYO) · HTTP 504 (SIN)”. A note goes in the thread as NOTE without @mentioning anyone.',
          },
        ],
      },
      {
        kind: 'callout',
        callout: {
          tone: 'info',
          title: 'Acknowledge stops the escalation — nothing else',
          text: fyi
            ? `Later levels and reminders stop. The client-update track keeps running, and on Tier 1 DOWN the CEO and the site’s AM still get an FYI (no call) at +${fyi.delayMin} min if the site is still down.`
            : 'Later levels and reminders stop. The client-update track keeps running.',
        },
      },
      {
        kind: 'ladder',
        title: 'Tier 1 DOWN · 24/7',
        note: 'Timers start at “Confirmed down” and pause while the site is up',
        rows: ladderRows(t1),
        cards: [
          ...tierCards.map((c) => ({
            title: c.title,
            text: `${policyLine(c.steps)}. No CEO page. Outside ${f.hours} it’s posted at once and the timers wait for the next opening.`,
          })),
          {
            title: 'PROBLEM · all tiers',
            text: `${policyLine(f.policies.problem)} · a reminder every ${f.problemReminderMin} min. Tier 1 outside response hours goes to on-call; Tier 2–3 outside response hours is held until the next opening.`,
          },
          {
            title: 'Until someone acknowledges',
            text: `A STILL DOWN reminder posts in the thread every ${f.downReminderMin} min. It never @mentions the CEO or the AM.`,
          },
        ],
      },
    ],
    related: [LINKS.incidents, LINKS.escalation],
    relatedTopics: ['client', 'resolve'],
  };

  const client: Draft = {
    id: 'client',
    group: 'When things go wrong',
    icon: 'mail',
    title: 'Client updates',
    summary: 'For AMs: draft, then Mark client updated or Not needed',
    keywords: 'client update am account manager draft mark updated not needed reason customer',
    roles: ['Responder', 'Stakeholder', 'Admin'],
    lede: 'When a client-facing outage runs long, the site’s AM is @mentioned with a draft message. The update is a separate track from escalation.',
    blocks: [
      {
        kind: 'bullets',
        items: [
          B(
            `Tier 1 DOWN reaching ${updT1} min:`,
            'the site’s AM is @mentioned in the incident thread with a draft client message and gets a “Client update due” email — whatever the ack state. With no active AM, every Admin gets it.',
          ),
          B(
            `Tier 2 DOWN reaching ${updT2} min`,
            'inside response hours: the AM is @mentioned too; minutes outside response hours don’t count. Tier 3 has no client update.',
          ),
          B('The minutes add up', 'across the incident’s drops, from its first failed check.'),
          B(
            'On the incident’s Client update card:',
            'copy the draft, contact the client, then Mark client updated — it records who and when, with an optional note.',
          ),
          B('Client doesn’t need one?', 'Choose Not needed… and give a reason — the reason is required.'),
          B(
            'Required only when the track fired.',
            `A Tier 1 DOWN longer than ${updT1} min can’t be resolved until the update is marked or Not needed.`,
          ),
          B(
            'Who can mark:',
            'Admins, Responders on sites they own or back up, and the client’s AM. Not Viewers.',
          ),
        ],
      },
      {
        kind: 'callout',
        callout: {
          tone: 'info',
          title: 'Acknowledge doesn’t stop the client-update track',
          text: `The AM is still @mentioned at ${updT1} min even if someone acknowledged at 5 min.`,
        },
      },
    ],
    related: [LINKS.incidents],
    relatedTopics: ['alert', 'resolve'],
  };

  const resolve: Draft = {
    id: 'resolve',
    group: 'When things go wrong',
    icon: 'pencil',
    title: 'Recover, root cause & resolve',
    summary: 'Monitoring → Needs root cause → Resolved',
    keywords: 'recover recovered root cause resolve resolved monitoring unknown auto-resolve conditions undo',
    roles: ['Responder', 'On-call', 'Admin'],
    lede: 'A recovered site isn’t a finished incident. Resolve is always done by a person and needs 3 conditions.',
    blocks: [
      {
        kind: 'lifecycle',
        states: ['unacked', 'escalated', 'acknowledged', 'monitoring', 'needs_root_cause', 'resolved'],
        note: 'Fails again before Resolved → joins the same incident and thread; back to Acknowledged if someone acked, otherwise Unacked.',
      },
      {
        kind: 'steps',
        items: [
          {
            title: 'The site recovers',
            badge: 'monitoring',
            text: 'On the first OK round the state becomes Monitoring and the RECOVERED reply goes out in the same thread.',
          },
          {
            title: 'Two OK rounds',
            badge: 'needs_root_cause',
            text: 'After 2 OK rounds it moves to Needs root cause — unless a root cause is already written.',
          },
          {
            title: 'Write the root cause',
            text: 'Pick a category, say what happened and, if you know, what fixed it. “Unknown — keep investigating” saves your notes but keeps the incident open.',
          },
          {
            title: 'Press Resolve',
            badge: 'resolved',
            text: 'Resolve opens once the site has recovered and the client update is done; the dialog waits for the root cause. Like an ack, it’s held 10 s with Undo — “Posting to Chat and email in N s — nothing is sent until then”.',
            gates: [
              { t: 'OK for 2 rounds', d: 'The site has passed two check rounds in a row.' },
              {
                t: 'Client update marked — or not required',
                d: `Required only if the track fired (Tier 1 DOWN over ${updT1} min, Tier 2 DOWN ${updT2} min inside response hours). Met by Mark client updated or Not needed + a reason.`,
              },
              { t: 'Root cause written', d: 'Any category except “Unknown — keep investigating”.' },
            ],
            mono: 'RESOLVED · Site name · by your name 10:08',
            after:
              'No @mention. The email goes in the same thread to everyone already emailed for that incident.',
          },
        ],
      },
      {
        kind: 'callout',
        callout: {
          tone: 'info',
          title: 'DOWN never resolves itself',
          text: 'Resolve is always a manual action once the 3 conditions are met. The only exception: a PROBLEM that recovers within 5 min of being flagged and was never acknowledged resolves itself on its first OK round — no root cause needed — and is hidden from Incidents by default. An Intermittent PROBLEM never does.',
        },
      },
    ],
    related: [LINKS.incidents],
    relatedTopics: ['client', 'statuses'],
  };

  const monitor: Draft = {
    id: 'monitor',
    group: 'When things go wrong',
    icon: 'monitor',
    title: 'When the monitor itself fails',
    summary: 'Fault alerts, hand checks and Escalate now',
    keywords:
      'monitor fault heartbeat engine probe healthchecks watchdog manual incident hand check escalate now',
    roles: ['On-call', 'Admin'],
    lede: 'If the monitor stops checking, you’re told by something outside it — and you check the important sites by hand until it’s back.',
    blocks: [
      {
        kind: 'bullets',
        items: [
          B(
            'The engine stops for 3 min or more:',
            'Healthchecks sends its alert, and the VPS watchdog posts MONITOR FAULT in the Alerts Space, @mentioning the person on call.',
          ),
          B(
            'One location (BKK, SIN or TYO) missing for 3 min or more:',
            'an email to every active Admin, no page — the other two locations still decide status. Not sent while the engine is stopped.',
          ),
          B(
            'Hand check:',
            'while the engine is stopped, Overview offers each Tier 1 site “Loads OK” or “Down — open incident”. Anyone who may acknowledge that site can press it.',
          ),
          B(
            '“Down — open incident”',
            'opens an incident with Trigger “Manual (hand check)”, posts L0 in the Alerts Space and starts the client-update track.',
          ),
          B(
            'Escalate by hand.',
            'When no engine run has happened for 3 min, the incident offers Escalate now (one level per press) and Send client-update reminder now. Automatic timers carry on once the engine is back.',
          ),
        ],
      },
    ],
    related: [LINKS.overview, LINKS.probes],
    relatedTopics: ['phone', 'alert'],
  };
  const faultCallout = oneAdminCallout(f, 'Monitor-fault emails');
  if (faultCallout) monitor.blocks.push({ kind: 'callout', callout: faultCallout });

  const mute: Draft = {
    id: 'mute',
    group: 'Everyday',
    icon: 'eye-off',
    title: 'Mute vs maintenance',
    summary: 'Mute stops new alerts only · maintenance can’t start on a DOWN site',
    keywords: 'mute maintenance window planned silence suppress reason end early cancel edit approval uptime',
    roles: ['Responder', 'On-call', 'Admin'],
    lede: 'Both quieten alerts, but they mean different things — for uptime and for an incident that’s already open.',
    blocks: [
      {
        kind: 'compare',
        rows: [
          {
            k: 'Use it for',
            mute: 'A known issue or noisy site, right now',
            maint: 'Planned work, scheduled ahead',
          },
          {
            k: 'Alerts',
            mute: 'New alerts stop; an open incident keeps escalating',
            maint: 'Held during the window; checks still run',
          },
          { k: 'Uptime', mute: 'Still counted', maint: 'Window not counted' },
          {
            k: 'How long',
            mute: 'Up to 24 h',
            maint: 'Over 24 h needs an Admin’s approval (Admins approve their own)',
          },
          {
            k: 'Who',
            mute: 'Admins · Responders on sites they own or back up · the person on call, on Tier 1',
            maint: 'Admins · Responders on sites they own or back up',
          },
        ],
      },
      {
        kind: 'callout',
        callout: {
          tone: 'info',
          title: 'Mute stops new alerts only',
          text: 'An open incident keeps its escalation, the FYI and the client-update track. Mute never counts as an acknowledgement.',
        },
      },
      {
        kind: 'steps',
        items: [
          {
            title: 'Site is DOWN right now? Mute, don’t schedule',
            text: 'A maintenance window can’t start now on a site whose incident hasn’t recovered — the sheet blocks it and offers Mute instead. A mute can’t start during maintenance, and maintenance that starts during a mute ends the mute.',
          },
          {
            title: 'Write the reason',
            text: 'Every mute and maintenance sheet needs a reason before you can submit. It’s kept in the audit log with the change.',
          },
          {
            title: 'End early, edit or cancel on Maintenance & mutes',
            text: 'Sidebar › Maintenance lists what’s on, waiting for approval and scheduled, with End now and Edit / cancel. Each asks for a reason, is held 10 s with Undo, and is logged.',
          },
        ],
      },
    ],
    related: [LINKS.maintenance, LINKS.audit],
    relatedTopics: ['statuses', 'alert'],
  };

  const now = f.onCallNow;
  const rotation: Draft = {
    id: 'rotation',
    group: 'Everyday',
    icon: 'users',
    title: 'On-call rotation',
    summary: 'Weekly shifts, swap requests, Hand over',
    keywords: 'on-call rotation shift week swap hand over handover night weekend holiday',
    roles: ['Responder', 'On-call', 'Admin'],
    lede: 'One person covers Tier 1 outside response hours for a week at a time. Swaps are asked for ahead; the live shift is handed over.',
    blocks: [
      {
        kind: 'bullets',
        items: [
          B(
            'Weekly, changing Monday 09:00.',
            `The person on call answers Tier 1 outside response hours (${f.hours}) and on company holidays; inside them the site owner does.`,
          ),
          now
            ? B(
                'Now:',
                `${shiftWords(now)}.${f.onCallNext.length ? ` Next: ${f.onCallNext.map(shiftWords).join(', ')}.` : ''}`,
              )
            : B(
                'Nobody is on call right now.',
                'Tier 1 alerts outside response hours go to the site owners.',
              ),
          B(
            'Swap:',
            'ask for one on your own future weeks from On-call. The person asked accepts or declines there, then an Admin approves — nothing changes until then. A swap still open when its week starts expires.',
          ),
          B('The live shift can’t be swapped.', 'An Admin uses Hand over… on the live row of On-call.'),
          ...(t1Admins !== null
            ? [B('Admins are the backstop.', `Every Admin is at L${t1Admins} of every Tier 1 DOWN.`)]
            : []),
        ],
      },
    ],
    related: [LINKS.oncall, LINKS.profile],
    relatedTopics: ['phone', 'alert'],
  };

  const reports: Draft = {
    id: 'reports',
    group: 'Everyday',
    icon: 'chart-column',
    title: 'Reports & client status page',
    summary: 'The daily digest, the weekly summary and how uptime is counted',
    keywords: 'report digest weekly summary uptime target status page client outage degraded',
    roles: ['Stakeholder', 'Admin'],
    lede: 'What the daily digest and the weekly summary tell you, and how uptime is counted. Client reports and the client status page aren’t in DxT Monitor yet.',
    blocks: [
      {
        kind: 'bullets',
        items: [
          B('Daily digest at 09:00', 'posts to the DxT Website Reports Space, not the Alerts Space.'),
          B('Weekly summary on Monday', 'posts there too, and the CEO gets it by email.'),
          B(
            'Uptime = 1 − DOWN minutes ÷ minutes in the window,',
            'with maintenance removed from both. PROBLEM counts as up; muted time is counted.',
          ),
          B(
            'Targets by tier, over 30 days:',
            ([1, 2, 3] as const)
              .map((t) => `Tier ${t} ${formatPercent(TIER_CONFIG[t].uptimeTarget)}`)
              .join(' · ') + '.',
          ),
        ],
      },
    ],
    related: [LINKS.overview, LINKS.sites],
    relatedTopics: ['statuses', 'client'],
  };

  const escalationBullets = [
    B(
      'L0 is pinned',
      'on every policy: owner or on-call, with Chat @mention and Alerts Space locked on. You can add people to it.',
    ),
    B(
      'Later steps:',
      'at least +15 min and later than the one before; every step needs a channel. A save needs a note and changes new incidents only — open ones keep the policy they opened with.',
    ),
    B(
      'The CEO only on Tier 1 DOWN, from L2 on.',
      'Voice shows “Configured · off until approved”. The Tier 1 FYI step can’t be removed or carry voice.',
    ),
  ];
  const usersBullet = B(
    'Used-in check:',
    'before you change a role or deactivate someone, the dialog lists where they’re used — site owner or backup, client AM, on-call shifts — and you reassign each first. Nobody changes their own role, and the last active Admin can’t be demoted.',
  );
  const adminCallout = oneAdminCallout(f, 'Monitor-fault emails');

  const admin: Draft = {
    id: 'admin',
    group: 'Admin',
    icon: 'settings',
    title: 'Escalation rules, users & roles',
    summary: 'Guardrails, the role matrix and the Used-in check',
    keywords:
      'admin escalation policy editor rules users roles permissions matrix used in deactivate change role ceo voice',
    roles: ['Admin'],
    lede: 'What the escalation editor won’t let you break, who can do what, and why a role change asks you to reassign first.',
    blocks: [
      { kind: 'bullets', items: [...escalationBullets, usersBullet] },
      { kind: 'matrix' },
      ...(adminCallout ? [{ kind: 'callout', callout: adminCallout } as const] : []),
    ],
    related: [LINKS.escalation, LINKS.users, LINKS.channels, LINKS.security],
    relatedTopics: [],
  };

  // The phone splits the Admin topic in two (spec §18, MGuide).
  const escalation: Draft = {
    ...admin,
    id: 'escalation',
    icon: 'arrow-up-right',
    title: 'Escalation rules',
    summary: 'Levels, timing and the guardrails when you edit them',
    keywords: 'admin escalation policy editor rules levels timing ceo voice',
    lede: 'What the escalation editor won’t let you break.',
    blocks: [{ kind: 'bullets', items: escalationBullets }],
    related: [LINKS.escalation],
    relatedTopics: ['alert', 'users'],
  };
  const users: Draft = {
    ...admin,
    id: 'users',
    icon: 'user',
    title: 'Users & roles',
    summary: 'Admin, Responder, Stakeholder, Viewer — and reassigning',
    keywords: 'admin users roles permissions matrix used in deactivate change role',
    lede: 'Who can do what, and why a role change asks you to reassign first.',
    blocks: [
      { kind: 'bullets', items: [usersBullet] },
      { kind: 'matrix' },
      ...(adminCallout ? [{ kind: 'callout', callout: adminCallout } as const] : []),
    ],
    related: [LINKS.users],
    relatedTopics: ['signin', 'escalation'],
  };

  return [
    signin,
    phone,
    statuses,
    mute,
    rotation,
    reports,
    alert,
    client,
    resolve,
    monitor,
    admin,
    escalation,
    users,
  ];
}

const PHONE_ONLY = new Set(['escalation', 'users']);

/** The topics for a layout, in the boards' order, with Admin-only links left out for everyone else. */
export function guideTopics(f: GuideFacts, layout: GuideLayout): Topic[] {
  return drafts(f)
    .filter((d) => (layout === 'phone' ? d.id !== 'admin' : !PHONE_ONLY.has(d.id)))
    .map((d) => finish({ ...d, related: d.related.filter((r) => f.isAdmin || !ADMIN_ONLY.has(r.href)) }));
}
