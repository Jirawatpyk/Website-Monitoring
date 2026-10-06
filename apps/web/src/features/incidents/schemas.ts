import { z } from 'zod';

/** An incident id from a URL or a form: a uuid, nothing else reaches the database. */
export const incidentIdSchema = z.uuid();
