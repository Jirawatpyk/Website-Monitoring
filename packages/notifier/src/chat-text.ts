/**
 * Google Chat text line (spec §10, §14.10). Every alert and thread reply has a plain text line before
 * the card; @mentions live only there (card mentions don't notify), and the line always starts with
 * STATE · site so a phone notification reads on its own.
 *
 * Full event → text line → who is @mentioned table: ChatAlert board (docs/design/canvas/ChatAlert.dc.html).
 */

/** A ladder level after L0 (`escalation_steps.level`, at most L3). */
export type StepLevel = 1 | 2 | 3;

export type ChatState =
  | 'DOWN'
  | 'PROBLEM'
  | 'DOWN AGAIN'
  | 'PROBLEM AGAIN'
  | `ESCALATED · L${StepLevel}`
  | 'STILL DOWN'
  | 'STILL PROBLEM'
  // S10: any level an edited ladder can have (L1–L3) — an FYI step at L2 once L2 is deleted, too.
  | `FYI · L${StepLevel}`
  | `REMINDER · L${StepLevel}`
  | 'CLIENT UPDATE DUE'
  | 'ACKNOWLEDGED'
  | 'RECOVERED'
  | 'RESOLVED'
  | 'NOTE'
  | 'MONITOR FAULT'
  | 'TEST — no action'
  // Maintenance and mutes (S09b, spec §24, D-037).
  | 'MAINTENANCE REQUESTED'
  | 'MAINTENANCE SCHEDULED'
  | 'MAINTENANCE APPROVED'
  | 'MAINTENANCE DECLINED'
  | 'REQUEST WITHDRAWN'
  | 'REQUEST CHANGED'
  | 'MAINTENANCE CHANGED'
  | 'MAINTENANCE CANCELLED'
  | 'MAINTENANCE STARTED'
  | 'MAINTENANCE ENDED'
  | 'MAINTENANCE ENDED EARLY'
  | 'DIDN’T START'
  | 'NOT APPROVED'
  | 'MUTED'
  | 'MUTE CHANGED'
  | 'MUTE ENDED'
  | 'MUTE ENDED EARLY'
  | 'WAITING FOR APPROVAL'
  | 'STILL WAITING'
  | 'APPROVED'
  | 'DECLINED';

export interface ChatTextLine {
  state: ChatState;
  site: string;
  /** Google Chat user ids to notify, e.g. "ARM" → `<users/ARM>`. */
  mention?: readonly string[];
  /** The rest of the line, already in words: "MuvMi (Tier 1) · acknowledge by 10:03 or it escalates". */
  detail?: readonly string[];
}

export function chatMention(userId: string): string {
  return `<users/${userId}>`;
}

export function buildChatTextLine({ state, site, mention = [], detail = [] }: ChatTextLine): string {
  const head = [state, site, ...detail].join(' · ');
  return mention.length ? `${mention.map(chatMention).join(' ')} ${head}` : head;
}
