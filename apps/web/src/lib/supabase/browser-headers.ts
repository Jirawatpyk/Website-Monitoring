/**
 * The browser's User-Agent, forwarded to Supabase Auth so a session created or refreshed from the server
 * records the device the person is on rather than "node" (D-062 item 12: the device names on Profile and
 * Security). It's the person's own header and only ever shown back as a parsed label (`deviceLabel`).
 * Capped so an oversized header never reaches Auth.
 */
export function browserHeaders(userAgent: string | null): Record<string, string> {
  const ua = userAgent?.trim().slice(0, 512);
  return ua ? { 'User-Agent': ua } : {};
}
