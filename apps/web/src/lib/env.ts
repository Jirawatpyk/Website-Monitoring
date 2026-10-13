import 'server-only';
import { z } from 'zod';

/**
 * Server environment, validated on first use (not at import) so `next build` works without secrets.
 * Public values are read directly from `process.env.NEXT_PUBLIC_*` where needed.
 */
const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  /** Public base URL; alert cards link to incidents under it (fallback: VERCEL_PROJECT_PRODUCTION_URL). */
  NEXT_PUBLIC_APP_URL: z.url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  CRON_SECRET: z.string().min(32, 'CRON_SECRET must be at least 32 characters'),
  INGEST_TOKEN: z.string().min(32, 'INGEST_TOKEN must be at least 32 characters'),
  /** The company Workspace domain, or several separated by commas (D-007): `eqho.com,omg-group.asia`. */
  ALLOWED_EMAIL_DOMAIN: z.string().min(1),
  GOOGLE_CHAT_ALERTS_WEBHOOK_URL: z.url().optional(),
  GOOGLE_CHAT_REPORTS_WEBHOOK_URL: z.url().optional(),
  RESEND_API_KEY: z.string().optional(),
  ALERT_EMAIL_FROM: z.string().optional(),
  PROBE_SECRET_HEADER_NAME: z.string().default('X-DxT-Monitor'),
  PROBE_SECRET_HEADER_VALUE: z.string().optional(),
  /** The Bangkok VPS's fixed public IP, shown on Add site for a WAF allowlist (S05; not a secret). */
  BKK_PROBE_IP: z.string().optional(),
  HEALTHCHECKS_PING_URL_ENGINE: z.url().optional(),
  HEALTHCHECKS_PING_URL_PROBE_SIN: z.url().optional(),
  HEALTHCHECKS_PING_URL_PROBE_TYO: z.url().optional(),
  HEALTHCHECKS_PING_URL_NOTIFIER: z.url().optional(),
  HEALTHCHECKS_PING_URL_CRAWLER: z.url().optional(),
  /**
   * D-042: shared-list and crawler-view findings raise PROBLEM only when `on`; `off` logs them in
   * the engine summary. Production stays off until S09c's week without a false positive.
   */
  DEFACEMENT_ALERTS: z.enum(['on', 'off']).default('off'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Names only — never log values.
    const names = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid server environment: ${names}`);
  }
  cached = parsed.data;
  return cached;
}

/**
 * The probe facts Add site shows for a WAF allowlist (S05): the Bangkok VPS IP and the secret
 * header's name — never its value. Read on their own so a page doesn't need every server secret
 * (`serverEnv()` refuses to run without them, e.g. in the CI e2e job).
 */
export function probeAllowlistInfo(): { bkkIp: string | null; secretHeaderName: string } {
  return {
    bkkIp: process.env.BKK_PROBE_IP?.trim() || null,
    secretHeaderName: process.env.PROBE_SECRET_HEADER_NAME?.trim() || 'X-DxT-Monitor',
  };
}
