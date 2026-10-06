import 'server-only';
import type { Json } from '@dxt/db';
import type { ServerClient } from '@/lib/supabase/server';

export interface AuditEntry {
  /** What happened, `entity.verb` — e.g. `site.mute`, `incident.ack`. */
  action: string;
  /** Table-level noun — e.g. `site`, `incident`, `profile`. */
  entity: string;
  entityId: string | null;
  before?: Json;
  after?: Json;
}

/**
 * Record a config or incident-state change by the signed-in user (append-only `audit_log`, PRD §11).
 * Server Actions call this after the change succeeds; the database refuses anyone without an active
 * profile and stamps the actor itself. Throws so a change is never silently left unaudited.
 */
export async function writeAudit(supabase: ServerClient, entry: AuditEntry): Promise<string> {
  const { data, error } = await supabase.rpc('write_audit', {
    p_action: entry.action,
    p_entity: entry.entity,
    p_entity_id: entry.entityId ?? undefined,
    p_before: entry.before ?? undefined,
    p_after: entry.after ?? undefined,
  });
  if (error || !data) throw new Error(`Audit log write failed: ${error?.message ?? 'no id returned'}`);
  return data;
}
