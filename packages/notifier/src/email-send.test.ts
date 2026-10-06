import { describe, expect, it, vi } from 'vitest';
import { sendEmail } from './email-send';

const message = {
  subject: 'S · Tier 1 · INC-0001',
  html: '<p>x</p>',
  text: 'x',
  headers: { 'Message-ID': '<m@d>' },
};
const opts = {
  apiKey: 're_secret',
  from: 'DxT Monitor <alerts@notify.example.test>',
  to: 'arm@example.test',
  idempotencyKey: 'notification-n1',
};

describe('sendEmail (Resend)', () => {
  it('posts one email per person with the idempotency key and headers', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ id: 'em_1' }));
    expect(await sendEmail(message, { ...opts, fetchImpl })).toEqual({ ok: true, id: 'em_1' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer re_secret');
    expect(headers['idempotency-key']).toBe('notification-n1');
    expect(JSON.parse(init.body as string)).toEqual({
      from: opts.from,
      to: ['arm@example.test'],
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: message.headers,
    });
  });

  it('accepts a success without an id', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));
    expect(await sendEmail(message, { ...opts, fetchImpl })).toEqual({ ok: true, id: null });
  });

  it.each([
    [429, true],
    [500, true],
    [409, true],
    [422, false],
    [403, false],
  ])('HTTP %i → retryable %s', async (status, retryable) => {
    const fetchImpl = vi.fn(async () => Response.json({ name: 'error', message: 'nope' }, { status }));
    expect(await sendEmail(message, { ...opts, fetchImpl })).toEqual({
      ok: false,
      error: `HTTP ${status}: error: nope`,
      retryable,
    });
  });

  it('never stores the address or the key in an error', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ name: 'validation_error', message: 'Invalid `to`: arm@example.test' }, { status: 422 }),
    );
    const result = await sendEmail(message, { ...opts, fetchImpl });
    expect(JSON.stringify(result)).not.toMatch(/arm@example|re_secret/);
    expect(result).toMatchObject({ ok: false, error: 'HTTP 422: validation_error: Invalid `to`: <address>' });
  });

  it('reports a timeout and a network error as retryable', async () => {
    const timeout = vi.fn(async () => {
      throw new DOMException('t', 'TimeoutError');
    });
    expect(await sendEmail(message, { ...opts, fetchImpl: timeout })).toEqual({
      ok: false,
      error: 'Timeout',
      retryable: true,
    });
    const network = vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
    });
    expect(await sendEmail(message, { ...opts, fetchImpl: network })).toEqual({
      ok: false,
      error: 'ECONNRESET',
      retryable: true,
    });
    const odd = vi.fn(async () => {
      throw 'odd';
    });
    expect(await sendEmail(message, { ...opts, fetchImpl: odd })).toEqual({
      ok: false,
      error: 'Network error',
      retryable: true,
    });
  });
});
