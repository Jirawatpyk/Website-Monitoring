import { describe, expect, it, vi } from 'vitest';
import { postChatMessage } from './chat-webhook';

const message = { text: 'DOWN · Site (Tier 1)', cardsV2: [] };
const webhook = 'https://chat.googleapis.com/v1/spaces/S/messages?key=K&token=T';

describe('postChatMessage', () => {
  it('posts JSON to the webhook, threaded by the key, replying when the thread exists', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ name: 'spaces/S/messages/M' }));
    const result = await postChatMessage(webhook, message, { threadKey: 'inc-1', fetchImpl });

    expect(result).toEqual({ ok: true, messageName: 'spaces/S/messages/M' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.searchParams.get('key')).toBe('K');
    expect(url.searchParams.get('token')).toBe('T');
    expect(url.searchParams.get('threadKey')).toBe('inc-1');
    expect(url.searchParams.get('messageReplyOption')).toBe('REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(message);
  });

  it('reports an HTTP error without the webhook URL', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad card', { status: 400 }));
    const result = await postChatMessage(webhook, message, { threadKey: 'inc-1', fetchImpl });
    expect(result).toEqual({ ok: false, error: 'HTTP 400: bad card' });
    expect(JSON.stringify(result)).not.toContain('token');
  });

  it('accepts a success without a message name', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));
    expect(await postChatMessage(webhook, message, { threadKey: 'k', fetchImpl })).toEqual({
      ok: true,
      messageName: null,
    });
  });

  it('turns a timeout or network failure into an error, never a throw', async () => {
    const timeout = vi.fn(async () => {
      throw new DOMException('t', 'TimeoutError');
    });
    expect(await postChatMessage(webhook, message, { threadKey: 'k', fetchImpl: timeout })).toEqual({
      ok: false,
      error: 'Timeout',
    });
    const refused = vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    });
    expect(await postChatMessage(webhook, message, { threadKey: 'k', fetchImpl: refused })).toEqual({
      ok: false,
      error: 'ECONNREFUSED',
    });
    const other = vi.fn(async () => {
      throw new Error('boom');
    });
    expect(await postChatMessage(webhook, message, { threadKey: 'k', fetchImpl: other })).toEqual({
      ok: false,
      error: 'Network error',
    });
  });
});
