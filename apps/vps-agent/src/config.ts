import { z } from 'zod';

/** Google and Cloudflare: two providers, so one of them having a bad minute isn't a control failure. */
export const DEFAULT_CONTROL_URLS = [
  'https://www.gstatic.com/generate_204',
  'https://www.cloudflare.com/cdn-cgi/trace',
] as const;

const configSchema = z.object({
  /** Base URL of the web app (Ingest / Job APIs). HTTPS only, so the token never travels in clear text. */
  API_BASE_URL: z.url().refine((value) => {
    const { protocol, hostname } = new URL(value);
    return protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  }, 'API_BASE_URL must use https:// (http is allowed for localhost only)'),
  /** Same value as the web app's INGEST_TOKEN. The VPS never holds a database key. */
  INGEST_TOKEN: z.string().min(32),
  /** Healthchecks.io URLs pinged after every probe round / once a minute by the verifier (PRD §9). */
  HEALTHCHECKS_PING_URL_PROBE_BKK: z.url().optional(),
  HEALTHCHECKS_PING_URL_VERIFIER: z.url().optional(),
  PROBE_SECRET_HEADER_NAME: z.string().default('X-DxT-Monitor'),
  PROBE_SECRET_HEADER_VALUE: z.string().optional(),
  /** Browser verifier: at most 3 Chromium sessions (PRD §5); staging runs 1 beside production (D-019). */
  VERIFIER_MAX_SESSIONS: z.coerce.number().int().min(1).max(3).default(3),
  /** How often the verifier asks for work; a job left 30 s counts the verifier unavailable (D-019). */
  VERIFIER_POLL_MS: z.coerce.number().int().min(1_000).max(10_000).default(5_000),
  LOOP_INTERVAL_MS: z.coerce.number().int().min(10_000).default(60_000),
  /**
   * Control check (D-027): two or three public https URLs run by different providers, checked every
   * round. Only when all fail is the VPS's own network suspect, so its results can't decide a site
   * behind a WAF.
   */
  CONTROL_URLS: z
    .string()
    .optional()
    // Unset or blank (an env file copied from .env.example) = the defaults.
    .transform((v) => {
      const urls = (v ?? '')
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean);
      return urls.length ? urls : [...DEFAULT_CONTROL_URLS];
    })
    .pipe(
      z
        .array(z.url({ protocol: /^https$/ }))
        .min(2)
        .max(3),
    ),
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
