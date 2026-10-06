import 'server-only';

/**
 * Public base URL for links in messages: NEXT_PUBLIC_APP_URL, else the Vercel project's production
 * domain (set by Vercel on every deployment), else the local dev server.
 */
export function appBaseUrl(
  configured: string | undefined,
  vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL,
): string {
  if (configured) return configured;
  if (vercelHost) return `https://${vercelHost}`;
  return 'http://localhost:3500';
}
