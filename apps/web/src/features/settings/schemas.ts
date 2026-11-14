import { z } from 'zod';
import { EMAIL_SHAPE, STAFF_ROLES } from './model';

const role = z.enum(STAFF_ROLES, 'Pick Admin, Responder, Stakeholder or Viewer');

/** Add a primary Google address to the access list with a role (D-007, D-062 item 2). */
export const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .regex(EMAIL_SHAPE, 'Enter their primary Google address, e.g. name@company'),
  role,
});
export type InviteInput = z.infer<typeof inviteSchema>;

export const revokeSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).regex(EMAIL_SHAPE, 'That isn’t an address on the list'),
  reason: z
    .string()
    .trim()
    .min(1, 'Add a short reason — it goes in the audit log')
    .max(500, 'Keep it under 500 characters.'),
});
export type RevokeInput = z.infer<typeof revokeSchema>;

/** The dialog's picks: `{owners: {site: person}, backups: {…}, am, shifts}` (PR 1's `p_reassign`). */
const reassign = z
  .object({
    owners: z.record(z.uuid(), z.uuid()).optional(),
    backups: z.record(z.uuid(), z.uuid()).optional(),
    am: z.uuid().optional(),
    shifts: z.uuid().optional(),
  })
  .strict();

export const changeRoleSchema = z.object({ userId: z.uuid(), role, reassign });
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;

export const deactivateSchema = z.object({ userId: z.uuid(), reassign });
export type DeactivateInput = z.infer<typeof deactivateSchema>;

/** A Google Chat user id (D-015): digits, or empty to clear it. */
export const chatIdSchema = z.object({
  userId: z.uuid(),
  chatId: z
    .string()
    .trim()
    .max(40, 'A Chat user id is digits only')
    .regex(/^\d*$/, 'A Chat user id is digits only'),
});
export type ChatIdInput = z.infer<typeof chatIdSchema>;
