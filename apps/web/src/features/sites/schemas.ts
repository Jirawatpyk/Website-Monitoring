import { z } from 'zod';
import {
  keyPagePathSchema,
  MAX_KEY_PAGES,
  monitorFormSchema,
  monitorHeadersSchema,
  monitorUrlSchema,
  siteFormSchema,
} from '@dxt/shared';

export const siteIdSchema = z.uuid();

/** Add site: the site, its primary monitor, key-page paths, and Save draft vs Start monitoring. */
export const createSiteInputSchema = z.object({
  site: siteFormSchema,
  primary: monitorFormSchema.refine((m) => m.isPrimary, 'The first monitor is the primary'),
  keyPages: z.array(keyPagePathSchema).max(MAX_KEY_PAGES, 'At most 3 key pages per site').default([]),
  start: z.boolean().default(false),
});
export type CreateSiteInput = z.input<typeof createSiteInputSchema>;

/** Edit site: the site fields only (monitors on their own page). */
export const updateSiteInputSchema = z.object({ siteId: siteIdSchema, site: siteFormSchema });
export type UpdateSiteInput = z.input<typeof updateSiteInputSchema>;

/** Edit monitors' Save changes: what changed and what goes. */
export const saveMonitorsInputSchema = z.object({
  siteId: siteIdSchema,
  upserts: z.array(monitorFormSchema).max(MAX_KEY_PAGES + 1),
  removals: z.array(z.uuid()).max(MAX_KEY_PAGES).default([]),
});
export type SaveMonitorsInput = z.input<typeof saveMonitorsInputSchema>;

/** Test check (AddSite, EditMonitors): the unsaved settings, run once, nothing stored (D-025). */
export const testCheckInputSchema = z.object({
  url: monitorUrlSchema,
  method: z.enum(['GET', 'HEAD']).default('GET'),
  timeoutSec: z.coerce.number().int().min(1).max(60).default(30),
  mustContain: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  mustNotContain: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  headers: monitorHeadersSchema.default([]),
});
export type TestCheckInput = z.input<typeof testCheckInputSchema>;
