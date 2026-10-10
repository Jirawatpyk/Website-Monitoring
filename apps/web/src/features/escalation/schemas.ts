import { escalationStepSchema } from '@dxt/shared';
import { z } from 'zod';

/** What the save dialog sends (the SQL re-checks every guardrail, D-034). */
export const saveEscalationInputSchema = z.object({
  policies: z
    .array(z.object({ policyId: z.uuid(), steps: z.array(escalationStepSchema).min(1).max(4) }))
    .max(4),
  downReminderMin: z.number().int().min(1).max(1440),
  problemReminderMin: z.number().int().min(1).max(1440),
  note: z.string().trim().min(1, 'Add a short note — it goes in the audit log with the change').max(500),
});
export type SaveEscalationInput = z.infer<typeof saveEscalationInputSchema>;
