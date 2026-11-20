import { HOLIDAY_KINDS } from '@dxt/shared';
import { z } from 'zod';
import { HOLIDAY_NAME_MAX } from './holidays';
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

const holidayName = z
  .string()
  .trim()
  .min(1, 'Give the day a name.')
  .max(HOLIDAY_NAME_MAX, 'Up to 100 characters.');

/** Add a holiday (OrganisationLists): a Bangkok date, a name and its kind; the SQL checks the range. */
export const addHolidaySchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a day.'),
  name: holidayName,
  kind: z.enum(HOLIDAY_KINDS),
});
export type AddHolidayInput = z.input<typeof addHolidaySchema>;

export const renameHolidaySchema = z.object({ id: z.uuid(), name: holidayName });
export type RenameHolidayInput = z.input<typeof renameHolidaySchema>;

export const removeHolidaySchema = z.object({ id: z.uuid() });
