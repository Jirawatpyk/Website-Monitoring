/**
 * Where to go after sign-in. Only same-origin relative paths pass, so `?next=` can't be an open
 * redirect: `//evil.example`, `/\evil.example`, `https://…` and paths with control characters
 * (browsers strip tab/newline, turning `/\t/evil` into `//evil`) all fall back.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (!next || !next.startsWith('/')) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  if (next.startsWith('//')) return fallback;
  return next;
}

/**
 * Sign-in is limited to the company Google Workspace domain (PRD §3). Compares the part after the
 * last "@" exactly (case-insensitive), so `a@dxt.co.th.evil.com` and `a@evil.com?@dxt.co.th` fail.
 * An empty or missing allowed domain allows nobody — fail closed.
 */
export function isAllowedEmail(
  email: string | null | undefined,
  allowedDomain: string | null | undefined,
): boolean {
  const domain = allowedDomain?.trim().toLowerCase();
  if (!email || !domain) return false;
  const at = email.lastIndexOf('@');
  if (at <= 0) return false;
  return email.slice(at + 1).toLowerCase() === domain;
}
