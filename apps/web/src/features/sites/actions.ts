'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import * as m from './mutations';
import type { CreateSiteInput, SaveMonitorsInput, UpdateSiteInput } from './schemas';
import type { SiteActionResult } from './types';

/**
 * Server Actions for the Sites pages. Each runs as the signed-in person: zod, the SSRF guard, then
 * one SQL function that checks the role, the owners (D-015) and the checklist, and writes the audit
 * rows in the same transaction (D-025).
 */
async function deps(): Promise<m.SitesDeps> {
  return { db: await createClient() };
}

function refresh(result: SiteActionResult): SiteActionResult {
  if (result.ok) {
    revalidatePath('/sites');
    revalidatePath(`/sites/${result.siteId}`, 'layout');
  }
  return result;
}

export async function createSite(input: CreateSiteInput): Promise<SiteActionResult> {
  return refresh(await m.createSite(input, await deps()));
}

export async function updateSite(input: UpdateSiteInput): Promise<SiteActionResult> {
  return refresh(await m.updateSite(input, await deps()));
}

export async function setSiteMonitoring(siteId: string, on: boolean): Promise<SiteActionResult> {
  return refresh(await m.setMonitoring(siteId, on, await deps()));
}

export async function deleteSite(siteId: string): Promise<SiteActionResult> {
  const result = await m.deleteSite(siteId, await deps());
  if (result.ok) revalidatePath('/sites');
  return result;
}

export async function saveMonitors(input: SaveMonitorsInput): Promise<SiteActionResult> {
  return refresh(await m.saveMonitors(input, await deps()));
}
