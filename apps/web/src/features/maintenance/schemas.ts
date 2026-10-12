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
