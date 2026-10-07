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
  // Sign-in pages are never a destination: returning there after signing in would loop.
  if (/^\/(login|auth)(?=[/?#]|$)/.test(next)) return fallback;
  return next;
}

/**
 * The company's Google Workspace domains from `ALLOWED_EMAIL_DOMAIN`: one domain, or several
 * separated by commas (`eqho.com,omg-group.asia` — a colleague whose primary address is on the
 * group's domain, D-007). Trimmed, lower-cased, empties dropped.
 */
export function parseAllowedDomains(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Sign-in is limited to the company Google Workspace domains (PRD §3, D-007). Compares the part
 * after the last "@" exactly (case-insensitive) with each allowed domain, so
 * `a@dxt.co.th.evil.com` and `a@evil.com?@dxt.co.th` fail. No allowed domain allows nobody — fail
 * closed. The allowlist (`before_user_created`) still decides who gets an account.
 */
export function isAllowedEmail(
  email: string | null | undefined,
  allowedDomains: string | null | undefined,
): boolean {
  const domains = parseAllowedDomains(allowedDomains);
  if (!email || !domains.length) return false;
  const at = email.lastIndexOf('@');
  if (at <= 0) return false;
  return domains.includes(email.slice(at + 1).toLowerCase());
}
