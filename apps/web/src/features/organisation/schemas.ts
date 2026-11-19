import { z } from 'zod';
import { DAY_SET_LABELS, TIME_OPTIONS, type DaySet } from './model';

const time = z.string().refine((t) => TIME_OPTIONS.includes(t), 'Pick a time between 06:00 and 22:00');

/** Save the response hours (Organisation board's confirm): the board's choices and a required note. */
export const saveHoursSchema = z
  .object({
    days: z.enum(DAY_SET_LABELS as [DaySet, ...DaySet[]]),
    from: time,
    to: time,
    note: z
      .string()
      .trim()
      .min(1, 'Add a short note — it goes in the audit log with the change')
      .max(500, 'The note is too long'),
  })
  .refine((h) => h.from < h.to, { message: '“To” must be after “From”', path: ['to'] });
export type SaveHoursInput = z.input<typeof saveHoursSchema>;
