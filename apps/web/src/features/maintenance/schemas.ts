import { seriesRuleSchema } from '@dxt/shared';
import { z } from 'zod';

const reason = z
  .string()
  .trim()
  .min(1, 'Type a reason — it goes in the audit log with the change.')
  .max(500, 'The reason is too long (500 characters at most).');
const instant = z.iso.datetime({ offset: true });

/** Schedule or start a maintenance window (the SQL re-checks the guard and the approval, D-036). */
export const createMaintenanceSchema = z.object({
  siteId: z.uuid(),
  startsAt: instant,
  endsAt: instant,
  reason,
});
export type CreateMaintenanceInput = z.infer<typeof createMaintenanceSchema>;

/** Mute a site now until `endsAt` (at most 24 h, spec §11). */
export const muteSiteSchema = z.object({ siteId: z.uuid(), endsAt: instant, reason });
export type MuteSiteInput = z.infer<typeof muteSiteSchema>;

/** End early, or cancel, a window or mute (Overview "Maintenance & mutes"). */
export const windowReasonSchema = z.object({ windowId: z.uuid(), reason });
export type WindowReasonInput = z.infer<typeof windowReasonSchema>;

/** Move a window's or mute's end. */
export const editWindowSchema = z.object({ windowId: z.uuid(), endsAt: instant, reason });
export type EditWindowInput = z.infer<typeof editWindowSchema>;

/** `endsAt` = the end the Admin saw: a request changed meanwhile is refused (security review M2). */
export const approveSchema = z.object({ windowId: z.uuid(), endsAt: instant });
export type ApproveInput = z.infer<typeof approveSchema>;

/** Undo the last held action on a window (§24.8). */
export const windowIdSchema = z.object({ windowId: z.uuid() });
export type WindowIdInput = z.infer<typeof windowIdSchema>;

/** A repeating series (D-057): the rule as `valid_series_rule` takes it, Bangkok time and days. */
export const createSeriesSchema = z.object({
  siteId: z.uuid(),
  rule: seriesRuleSchema,
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Pick a time.'),
  durationMin: z.number().int().min(5).max(1440),
  startsOn: z.iso.date(),
  untilOn: z.iso.date().nullable(),
  reason,
});
export type CreateSeriesInput = z.infer<typeof createSeriesSchema>;

/** Approve (an optional note) or decline (a reason) a waiting series. */
export const seriesDecisionSchema = z.object({
  seriesId: z.uuid(),
  approve: z.boolean(),
  reason: z.string().trim().max(500),
});
export type SeriesDecisionInput = z.infer<typeof seriesDecisionSchema>;

/** Cancel a series, or withdraw a waiting one (a reason). */
export const seriesReasonSchema = z.object({ seriesId: z.uuid(), reason });
export type SeriesReasonInput = z.infer<typeof seriesReasonSchema>;

/** Undo, or post now, a series' last held action (§32 7a). */
export const seriesIdSchema = z.object({ seriesId: z.uuid() });
export type SeriesIdInput = z.infer<typeof seriesIdSchema>;
