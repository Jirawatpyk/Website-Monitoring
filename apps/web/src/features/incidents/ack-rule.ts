import type { Role } from '@dxt/shared';

/**
 * Who may acknowledge an incident on a site (D-016): an Admin on any site, a Responder on a site they
 * own as primary or backup — and, on a Tier 1 site, while on call or as the person L0 paged (S10,
 * D-048); Stakeholders (AM, CEO) and Viewers never (D-031). Display only — the
 * `ack_incident` SQL function (`private.can_ack`) is the rule that counts. Shared by the incident page
 * and the Overview.
 */
export function mayAcknowledge(
  viewer: { id: string; role: Role; onCallNow?: boolean },
  site: {
    primaryOwnerId: string | null;
    backupOwnerId: string | null;
    tier?: number;
    l0UserId?: string | null;
  },
): boolean {
  if (viewer.role === 'admin') return true;
  if (viewer.role !== 'responder') return false;
  if (site.primaryOwnerId === viewer.id || site.backupOwnerId === viewer.id) return true;
  return onCallActs(viewer, site);
}

/** The on-call branch alone: a Tier 1 site, and on call now or the person L0 paged. */
export function onCallActs(
  viewer: { id: string; onCallNow?: boolean },
  site: { tier?: number; l0UserId?: string | null },
): boolean {
  return site.tier === 1 && (viewer.onCallNow === true || site.l0UserId === viewer.id);
}
