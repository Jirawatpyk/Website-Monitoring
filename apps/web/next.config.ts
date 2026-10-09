import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';

function supabaseOrigins(): string[] {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return [];
  const url = new URL(raw);
  return [url.origin, `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`];
}

/**
 * Baseline CSP. `script-src` still allows inline scripts (Next bootstrap, ColorSchemeScript);
 * move to per-request nonces from the proxy when the app has real pages.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  // Evidence screenshots load from Supabase Storage signed URLs (S07).
  ["img-src 'self' data: blob:", ...supabaseOrigins().slice(0, 1)].join(' '),
  "font-src 'self'",
  [
    "connect-src 'self'",
    ...supabaseOrigins(),
    ...(isDev ? ['ws://localhost:*', 'ws://127.0.0.1:*'] : []),
  ].join(' '),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

const config: NextConfig = {
  poweredByHeader: false,
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ['@dxt/shared', '@dxt/engine', '@dxt/probe', '@dxt/notifier', '@dxt/db'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;
