import { z } from 'zod';
import { CHECK_OUTCOMES, PROBE_LOCATIONS } from './domain';

/**
 * One check result as a probe reports it. The VPS probe posts these to the Ingest API;
 * the Vercel probes write the same shape straight to `check_results`.
 */
export const checkResultSchema = z.object({
  monitorId: z.uuid(),
  location: z.enum(PROBE_LOCATIONS),
  checkedAt: z.iso.datetime(),
  outcome: z.enum(CHECK_OUTCOMES),
  statusCode: z.number().int().min(100).max(599).nullable(),
  responseMs: z.number().int().nonnegative().nullable(),
  ttfbMs: z.number().int().nonnegative().nullable(),
  resolvedIp: z.string().max(64).nullable(),
  error: z.string().max(500).nullable(),
  /** 1 = the scheduled check, 2 = the immediate recheck of a failure about 30 s later (PRD §5). */
  attempt: z.union([z.literal(1), z.literal(2)]).default(1),
});
export type CheckResultInput = z.infer<typeof checkResultSchema>;

/**
 * Ingest API body: a batch from the Bangkok VPS probe. It carries no `location` — the server sets
 * BKK itself, so a leaked INGEST_TOKEN can't impersonate the Singapore or Tokyo probes.
 */
export const ingestBatchSchema = z.object({
  results: z
    .array(checkResultSchema.omit({ location: true }))
    .min(1)
    .max(500),
});
export type IngestBatch = z.infer<typeof ingestBatchSchema>;
