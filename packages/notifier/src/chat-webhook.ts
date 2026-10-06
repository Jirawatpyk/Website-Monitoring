import type { ChatMessage } from './chat-alerts';

export type ChatPostResult = { ok: true; messageName: string | null } | { ok: false; error: string };

export interface ChatPostOptions {
  /** Every message of one incident shares a thread (PRD §7): the incident id. */
  threadKey: string;
  /**
   * Client-assigned message id (`client-…`): posting the same id twice is refused with 409, so a
   * retry after an unrecorded success never duplicates the message.
   */
  messageId?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Posts one message to a Google Chat incoming webhook, threaded by `threadKey` (a reply when the
 * thread exists, a new thread otherwise). Never throws; the webhook URL carries its key and token,
 * so it is never part of an error.
 */
export async function postChatMessage(
  webhookUrl: string,
  message: ChatMessage,
  { threadKey, messageId, timeoutMs = 10_000, fetchImpl = fetch }: ChatPostOptions,
): Promise<ChatPostResult> {
  const url = new URL(webhookUrl);
  url.searchParams.set('threadKey', threadKey);
  url.searchParams.set('messageReplyOption', 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD');
  if (messageId) url.searchParams.set('messageId', messageId);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Already posted under this messageId (an earlier attempt succeeded but wasn't recorded).
    if (res.status === 409 && messageId) return { ok: true, messageName: null };
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      return { ok: false, error: `HTTP ${res.status}${detail ? `: ${detail}` : ''}` };
    }
    const body = (await res.json().catch(() => ({}))) as { name?: unknown };
    return { ok: true, messageName: typeof body.name === 'string' ? body.name : null };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') return { ok: false, error: 'Timeout' };
    const cause =
      err instanceof Error ? (err as Error & { cause?: { code?: string } }).cause?.code : undefined;
    return { ok: false, error: cause ?? 'Network error' };
  }
}
