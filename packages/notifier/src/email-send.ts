import type { EmailMessage } from './email-alerts';

export type EmailSendResult =
  | { ok: true; id: string | null }
  /** `retryable`: a timeout, a network error, 429, 5xx or a concurrent request — worth another attempt. */
  | { ok: false; error: string; retryable: boolean };

export interface EmailSendOptions {
  apiKey: string;
  /** "DxT Monitor <alerts@…>". */
  from: string;
  to: string;
  /**
   * One key per message (`notification-<id>`): Resend answers a repeated key with the first
   * result for 24 h, so a retry after an unrecorded success never sends the email twice.
   */
  idempotencyKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const RESEND_URL = 'https://api.resend.com/emails';
// Provider messages can echo an address; an error is stored in the delivery log, so strip them.
const EMAIL_ADDRESS = /[^\s<>"'@]+@[^\s<>"'@]+/g;

/**
 * Sends one email through the Resend API. Never throws; the API key and the address never appear
 * in an error.
 */
export async function sendEmail(
  message: EmailMessage,
  { apiKey, from, to, idempotencyKey, timeoutMs = 10_000, fetchImpl = fetch }: EmailSendOptions,
): Promise<EmailSendResult> {
  try {
    const res = await fetchImpl(RESEND_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: message.headers,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { name?: unknown; message?: unknown };
      const detail = [body.name, body.message].filter((x) => typeof x === 'string').join(': ');
      return {
        ok: false,
        error: `HTTP ${res.status}${detail ? `: ${detail}` : ''}`
          .replace(EMAIL_ADDRESS, '<address>')
          .slice(0, 200),
        // 409 is worth a retry only while the same key is still in flight; a changed payload never is.
        retryable:
          res.status === 429 ||
          res.status >= 500 ||
          (res.status === 409 && body.name === 'concurrent_idempotent_requests'),
      };
    }
    const body = (await res.json().catch(() => ({}))) as { id?: unknown };
    return { ok: true, id: typeof body.id === 'string' ? body.id : null };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return { ok: false, error: 'Timeout', retryable: true };
    }
    const cause =
      err instanceof Error ? (err as Error & { cause?: { code?: string } }).cause?.code : undefined;
    return { ok: false, error: cause ?? 'Network error', retryable: true };
  }
}
