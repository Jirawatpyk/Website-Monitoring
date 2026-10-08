import type { SaveMonitorsInput } from '../schemas';
import type { MonitorRecord } from '../types';

/** A monitor as EditMonitors edits it: unsaved until Save changes. */
export interface MonitorDraft extends Omit<MonitorRecord, 'id'> {
  /** Stable key in the list (the id, or a temporary one for a new monitor). */
  key: string;
  id: string | null;
  removed: boolean;
}

export function toDrafts(records: MonitorRecord[]): MonitorDraft[] {
  return records.map((m) => ({ ...m, key: m.id, id: m.id, removed: false }));
}

const editable = (m: Omit<MonitorRecord, 'id'>) =>
  JSON.stringify([
    m.url,
    m.method,
    m.timeoutSec,
    m.mustContain,
    m.mustNotContain,
    m.allowedRedirectDomains,
    m.slowMs,
    m.headers,
    m.enabled,
  ]);

export function isEdited(d: MonitorDraft, originals: MonitorRecord[]): boolean {
  if (!d.id) return true;
  const o = originals.find((m) => m.id === d.id);
  return !o || editable(o) !== editable(d);
}

/** "/booking" for a key page; "/" for the home page. */
export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

/** The editor's title for a monitor (EditMonitors list and card). */
export function monitorTitle(d: Pick<MonitorDraft, 'isPrimary' | 'url' | 'id'>): string {
  if (d.isPrimary) return 'HTTP · home page';
  return d.id ? `Key page · ${pathOf(d.url)}` : 'Key page · new';
}

/** What Save changes would do, in the discard dialog's words. */
export function describeChanges(drafts: MonitorDraft[], originals: MonitorRecord[]): string[] {
  return drafts.flatMap((d) => {
    if (d.removed) return d.id ? [`removing ${monitorTitle(d)}`] : [];
    if (!d.id) return [`adding ${monitorTitle(d)}`];
    return isEdited(d, originals) ? [`edits to ${monitorTitle(d)}`] : [];
  });
}

/** The save_monitors input, plus which draft each upsert came from (to place field errors). */
export function toSaveInput(
  siteId: string,
  drafts: MonitorDraft[],
  originals: MonitorRecord[],
): { input: SaveMonitorsInput; keys: string[] } {
  const upserts = drafts.filter((d) => !d.removed && isEdited(d, originals));
  return {
    keys: upserts.map((d) => d.key),
    input: {
      siteId,
      upserts: upserts.map((d) => ({
        ...(d.id ? { id: d.id } : {}),
        isPrimary: d.isPrimary,
        url: d.url,
        method: d.method,
        timeoutSec: d.timeoutSec,
        mustContain: d.mustContain,
        mustNotContain: d.mustNotContain,
        allowedRedirectDomains: d.allowedRedirectDomains,
        ...(d.slowMs ? { slowMs: d.slowMs } : {}),
        headers: d.headers,
        enabled: d.enabled,
      })),
      removals: drafts.filter((d) => d.removed && d.id).map((d) => d.id!),
    },
  };
}
