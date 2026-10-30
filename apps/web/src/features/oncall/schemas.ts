import { z } from 'zod';

const TOO_LONG = 'Keep it under 500 characters.';
/** Optional: the person asked's answer, the requester's reason (empty → none). */
const note = z.string().trim().max(500, TOO_LONG).optional();
/** Required: an Admin's decline (§27.4) and a hand-over (§28.3) — the copy is the dialog's own. */
const required = (message: string) => z.string().trim().min(1, message).max(500, TOO_LONG);

/** Save the rotation's order (Admin): the SQL refuses an empty list, a repeat or someone not eligible. */
export const saveRotationSchema = z.object({
  userIds: z.array(z.uuid()).min(1, 'Add at least one person to the rotation').max(50),
});
export type SaveRotationInput = z.infer<typeof saveRotationSchema>;

/** Ask someone to swap: my week and the one they give up (their next future week, D-048 item 12). */
export const requestSwapSchema = z.object({ shiftId: z.uuid(), withShiftId: z.uuid(), reason: note });
export type RequestSwapInput = z.infer<typeof requestSwapSchema>;

/** The person asked accepts, or declines with an optional reason (§27.4). */
export const respondSwapSchema = z.object({ swapId: z.uuid(), accept: z.boolean(), note });
export type RespondSwapInput = z.infer<typeof respondSwapSchema>;

/** An Admin approves, or declines with a reason both of them see (§27.4). */
export const decideSwapSchema = z.discriminatedUnion('approve', [
  z.object({ swapId: z.uuid(), approve: z.literal(true) }),
  z.object({
    swapId: z.uuid(),
    approve: z.literal(false),
    note: required('Say why — both of them see this'),
  }),
]);
export type DecideSwapInput = z.infer<typeof decideSwapSchema>;

export const swapIdSchema = z.object({ swapId: z.uuid() });
export type SwapIdInput = z.infer<typeof swapIdSchema>;

/** Hand over the rest of a shift from `at` (Users board dialog, D-048 item 5). */
export const handOverSchema = z.object({
  shiftId: z.uuid(),
  to: z.uuid(),
  at: z.iso.datetime({ offset: true }),
  reason: required('Add a short reason — both of them see it'),
});
export type HandOverInput = z.infer<typeof handOverSchema>;

export const checklistSchema = z.object({ mentionsOnly: z.boolean(), dndAllowed: z.boolean() });
export type ChecklistInput = z.infer<typeof checklistSchema>;

/** The test link's token (`/oncall?test=<token>`, §27.8). */
export const testTokenSchema = z.object({ token: z.uuid() });
export type TestTokenInput = z.infer<typeof testTokenSchema>;
