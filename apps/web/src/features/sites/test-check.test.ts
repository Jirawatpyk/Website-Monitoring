// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { HttpCheckResult } from '@dxt/probe';
import type { Access } from '@/lib/auth/session';
import { monitorTestHandler } from './test-check';

const admin: Access = {
  status: 'active',
  profile: { id: 'u1', email: 'a@x.test', displayName: 'Tao', role: 'admin' },
};
const responder: Access = { ...admin, profile: { ...admin.profile, role: 'responder' } } as Access;

const pass: HttpCheckResult = {
  outcome: 'pass',
  statusCode: 200,
  responseMs: 412,
  ttfbMs: 200,
  error: null,
  bodySample: '',
  finalUrl: 'https://eqho.example.com/',
  keywordMissing: [],
  keywordForbidden: [],
  waf: null,
};

const post = (body: unknown) =>
  new Request('https://monitor.test/api/monitor-test/sin', { method: 'POST', body: JSON.stringify(body) });

function handler(access: Access, result: HttpCheckResult = pass) {
  const check = vi.fn(async () => result);
  const POST = monitorTestHandler('SIN', {
    access: async () => access,
    check,
    secretHeader: () => ({ name: 'X-DxT-Monitor', value: 's3cret' }),
    knownHost: async (host) => host === 'eqho.example.com',
  });
  return { POST, check };
}

describe('Test check route (D-025)', () => {
  it('runs one check with the form’s settings and the secret header, and stores nothing', async () => {
    const { POST, check } = handler(admin);
    const res = await POST(
      post({
        url: 'https://EQHO.example.com',
        mustContain: ['EQHO Academy'],
        timeoutSec: 45,
        headers: [{ name: 'Accept-Language', value: 'th' }],
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      location: 'SIN',
      outcome: 'pass',
      statusCode: 200,
      responseMs: 412,
      keywordMissing: [],
      keywordForbidden: [],
      error: null,
    });
    expect(check).toHaveBeenCalledWith({
      url: 'https://eqho.example.com/',
      method: 'GET',
      // Capped at the probes' 30 s.
      timeoutMs: 30_000,
      headers: { 'Accept-Language': 'th', 'X-DxT-Monitor': 's3cret' },
      mustContain: ['EQHO Academy'],
      mustNotContain: [],
    });
    expect(check.mock.calls[0]).not.toHaveProperty('0.allowPrivateTargets', true);
  });

  it('a host nobody monitors yet gets no secret header', async () => {
    const { POST, check } = handler(admin);
    await POST(post({ url: 'https://new.example.com', headers: [{ name: 'Accept-Language', value: 'th' }] }));
    expect(check).toHaveBeenCalledWith(expect.objectContaining({ headers: { 'Accept-Language': 'th' } }));
  });

  it('a private target comes back refused (the probe’s SSRF guard)', async () => {
    const { POST } = handler(admin, {
      ...pass,
      outcome: 'fail',
      statusCode: null,
      error: 'Target not allowed: private or reserved address',
    });
    const body = await (await POST(post({ url: 'http://169.254.169.254/' }))).json();
    expect(body).toMatchObject({
      outcome: 'refused',
      error: 'Target not allowed: private or reserved address',
    });
  });

  it('401 signed out, 403 for a Responder, 400 for a bad body', async () => {
    expect(
      (await handler({ status: 'signed-out' }).POST(post({ url: 'https://a.example.com' }))).status,
    ).toBe(401);
    expect((await handler(responder).POST(post({ url: 'https://a.example.com' }))).status).toBe(403);
    const { POST, check } = handler(admin);
    expect((await POST(post({ url: 'ftp://a.example.com' }))).status).toBe(400);
    expect(
      (await POST(post({ url: 'https://a.example.com', headers: [{ name: 'Cookie', value: 'x' }] }))).status,
    ).toBe(400);
    expect(
      (await POST(new Request('https://monitor.test/x', { method: 'POST', body: 'not json' }))).status,
    ).toBe(400);
    expect(check).not.toHaveBeenCalled();
  });
});
