import { z } from 'zod';
import { ROOT_CAUSE_CATEGORIES } from '@dxt/shared';

/** An incident id from a URL or a form: a uuid, nothing else reaches the database. */
export const incidentIdSchema = z.uuid();

/** A note (D-033): 1–2,000 characters after trimming — the same limits `add_incident_note` checks. */
export const noteSchema = z.object({
  incidentId: incidentIdSchema,
  text: z.string().trim().min(1, 'Write the note first').max(2000, 'Keep the note under 2,000 characters'),
});

/**
 * The root-cause form (Incident / Resolve boards, D-033): a category, "What happened" (required) and
 * "What fixed it" (optional) — the limits `private.root_cause_input` checks.
 */
export const rootCauseSchema = z.object({
  incidentId: incidentIdSchema,
  category: z.enum(ROOT_CAUSE_CATEGORIES, { error: 'Choose a category.' }),
  what: z
    .string()
    .trim()
    .min(1, 'Required — say what happened, even if the site recovered on its own.')
    .max(2000, 'Keep it under 2,000 characters'),
  fix: z.string().trim().max(500, 'Keep it under 500 characters').default(''),
});

export type NoteInput = z.input<typeof noteSchema>;
export type RootCauseInput = z.input<typeof rootCauseSchema>;
