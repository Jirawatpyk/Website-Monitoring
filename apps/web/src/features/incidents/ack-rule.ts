import type { Role } from '@dxt/shared';

/**
 * Who may acknowledge an incident on a site (D-016): an Admin on any site, a Responder on a site they
 * own as primary or backup; Stakeholders (AM, CEO) and Viewers never (D-031). Display only — the
 * `ack_incident` SQL function (`private.can_ack`) is the rule that counts. Shared by the incident page
 * and the Overview.
 */
export function mayAcknowledge(
  viewer: { id: string; role: Role },
  site: { primaryOwnerId: string | null; backupOwnerId: string | null },
): boolean {
  if (viewer.role === 'admin') return true;
  return (
    viewer.role === 'responder' && (site.primaryOwnerId === viewer.id || site.backupOwnerId === viewer.id)
  );
}
