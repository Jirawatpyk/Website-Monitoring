import { z } from 'zod';

const configSchema = z.object({
  /** Base URL of the web app (Ingest / Job APIs). HTTPS only, so the token never travels in clear text. */
  API_BASE_URL: z.url().refine((value) => {
    const { protocol, hostname } = new URL(value);
    return protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  }, 'API_BASE_URL must use https:// (http is allowed for localhost only)'),
  /** Same value as the web app's INGEST_TOKEN. The VPS never holds a database key. */
  INGEST_TOKEN: z.string().min(32),
  /** Healthchecks.io URL pinged after every loop (PRD §9). */
  HEALTHCHECKS_PING_URL_PROBE_BKK: z.url().optional(),
  PROBE_SECRET_HEADER_NAME: z.string().default('X-DxT-Monitor'),
  PROBE_SECRET_HEADER_VALUE: z.string().optional(),
  /** Browser verifier: at most 3 Chromium sessions on a 2 GB VPS (PRD §5). */
  VERIFIER_MAX_SESSIONS: z.coerce.number().int().min(1).max(3).default(3),
  LOOP_INTERVAL_MS: z.coerce.number().int().min(10_000).default(60_000),
});

export type AgentConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid agent environment: ${names}`);
  }
  return parsed.data;
}
