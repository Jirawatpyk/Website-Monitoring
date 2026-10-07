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
  // S04a (D-022): where the redirects ended and the keyword result. Optional, so a probe that
  // doesn't send them yet (a VPS agent not redeployed) still reports; null = not checked.
  finalUrl: z.url().max(2048).nullable().optional(),
  keywordMissing: z.array(z.string().max(200)).max(20).nullable().optional(),
  keywordForbidden: z.array(z.string().max(200)).max(20).nullable().optional(),
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

/**
 * Custom headers on the wire to the VPS. Loose on purpose (names are checked where they are saved,
 * `monitorHeadersSchema`, and the probe drops refused ones): one odd header mustn't fail a round.
 */
const wireHeadersSchema = z
  .array(z.object({ name: z.string().min(1).max(64), value: z.string().max(1024) }))
  .max(10)
  .default([]);

/** A monitor the Ingest API lists as due for the Bangkok probe (GET /api/ingest). */
export const dueMonitorSchema = z.object({
  id: z.uuid(),
  // A string, not z.url(): one URL the schema doubts would fail the whole round's list; the probe's
  // own SSRF guard (assertPublicTarget) refuses anything that isn't http(s).
  url: z.string().min(1),
  method: z.enum(['GET', 'HEAD']),
  timeoutMs: z.number().int().positive(),
  /** Keywords the probe checks (D-022); absent from a server that doesn't send them yet. */
  mustContain: z.array(z.string()).default([]),
  mustNotContain: z.array(z.string()).default([]),
  /** Custom request headers (S05, D-025); absent from a server that doesn't send them yet. */
  headers: wireHeadersSchema,
});
export type DueMonitor = z.infer<typeof dueMonitorSchema>;
export const dueMonitorsResponseSchema = z.object({ monitors: z.array(dueMonitorSchema) });

/** The query of a Job API poll: how many jobs the verifier can take, and its sessions in use. */
export const leaseQuerySchema = z.object({
  max: z.coerce.number().int().min(0).max(3).default(1),
  sessions: z.coerce.number().int().min(0).max(3).default(0),
});

/** A verification job leased to the browser verifier for 60 s (GET /api/jobs, D-019). */
export const leasedJobSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['verify', 'evidence']),
  url: z.url(),
  mustContain: z.array(z.string()),
  /** The monitor's custom headers, sent by the browser too (S05, D-025). */
  headers: wireHeadersSchema,
  /** One PUT of a JPEG to `url` stores the screenshot; the token is only good for this path. */
  upload: z.object({ url: z.url(), path: z.string() }).nullable(),
});
export type LeasedJob = z.infer<typeof leasedJobSchema>;
export const leasedJobsResponseSchema = z.object({ jobs: z.array(leasedJobSchema) });

/** A job's verdict from the verifier (POST /api/jobs). The screenshot path is never the agent's. */
export const verdictSchema = z.object({
  jobId: z.uuid(),
  /** loaded → OK + note; failed → DOWN; blocked = a WAF page in the browser too → PROBLEM (D-020). */
  result: z.enum(['loaded', 'failed', 'blocked']),
  /** Plain text: it can reach a Chat card's cause (markup stripped). */
  detail: z
    .string()
    .max(500)
    .transform((s) => s.replace(/[<>]/g, ''))
    .nullable()
    .default(null),
  httpStatus: z.number().int().min(100).max(599).nullable().default(null),
  /** The agent uploaded the screenshot to the signed URL it was given. */
  screenshot: z.boolean().default(false),
});
export type Verdict = z.input<typeof verdictSchema>;
