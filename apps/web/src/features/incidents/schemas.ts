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
  /** D-077: what stops it happening again — optional, internal (never in the client report). */
  prevent: z.string().trim().max(500, 'Keep it under 500 characters').default(''),
  /**
   * S09d (spec §26.7, D-046 item 10): a Page change resolved as Client-side change by an Admin may also
   * accept this plain fetch as the new baseline — the SQL checks the rest.
   */
  acceptCheckId: z.uuid().optional(),
});

export type NoteInput = z.input<typeof noteSchema>;
/** What a form sends: the category is any string until the schema checks it. */
export type RootCauseInput = Omit<z.input<typeof rootCauseSchema>, 'category'> & { category: string };

/** Mark client updated (optional note) / Not needed (reason required) — `mark_client_update`'s limits (S11, D-052). */
export const clientUpdateSchema = z
  .object({
    incidentId: incidentIdSchema,
    notNeeded: z.boolean(),
    note: z.string().trim().max(500, 'Keep it under 500 characters').default(''),
  })
  .refine((v) => !v.notNeeded || v.note.length > 0, { message: 'A reason is required.', path: ['note'] });

export type ClientUpdateInput = z.input<typeof clientUpdateSchema>;

/** "Down — open incident" from the hand check (S12b, spec §30.2): what they saw is optional, ≤ 500 characters. */
export const manualIncidentSchema = z.object({
  siteId: z.uuid(),
  note: z.string().trim().max(500, 'Keep it under 500 characters').default(''),
});

export type ManualIncidentInput = z.input<typeof manualIncidentSchema>;

/** "Down again" by hand on a site whose incident is still open (D-055 item 7): the note as above. */
export const downAgainSchema = z.object({
  incidentId: incidentIdSchema,
  note: z.string().trim().max(500, 'Keep it under 500 characters').default(''),
});

export type DownAgainInput = z.input<typeof downAgainSchema>;

/** Escalate now (spec §30.6): the level the person saw on the button (L1–L3). */
export const escalateNowSchema = z.object({ incidentId: incidentIdSchema, level: z.int().min(1).max(3) });

export type EscalateNowInput = z.input<typeof escalateNowSchema>;
