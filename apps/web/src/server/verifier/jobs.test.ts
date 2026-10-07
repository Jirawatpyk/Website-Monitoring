// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../../test/fake-db';
import { completeJob, completeJobSchema, leaseJobs, leaseQuerySchema, screenshotPath } from './jobs';

const now = new Date('2026-10-07T03:01:10Z');
const leased = (over: Record<string, unknown> = {}) => ({
  id: 'j1',
  kind: 'verify',
  url: 'https://tubtong.example.test',
  must_contain: ['Tubtong'],
  monitor_id: 'm1',
  created_at: '2026-10-07T03:01:05Z',
  ...over,
});

describe('leaseJobs (GET /api/jobs)', () => {
  it('beats, expires stale jobs, leases up to max, and signs one upload URL per job', async () => {
    const { db, calls, rpcCalls, storageCalls } = fakeDb({
      'rpc.claim_verification_jobs': { data: [leased()] },
      // The browser sends the monitor's custom headers too (S05).
      'monitors.select': { data: [{ id: 'm1', headers: [{ name: 'Accept-Language', value: 'th' }] }] },
      'storage.createSignedUploadUrl': {
        data: { signedUrl: 'https://s.example.test/upload?token=t', token: 't' },
      },
    });
    expect(await leaseJobs(db, { max: 2, sessions: 1 }, now)).toEqual([
      {
        id: 'j1',
        kind: 'verify',
        url: 'https://tubtong.example.test',
        mustContain: ['Tubtong'],
        headers: [{ name: 'Accept-Language', value: 'th' }],
        upload: { url: 'https://s.example.test/upload?token=t', path: '2026-10/j1.jpg' },
      },
    ]);
    expect(calls[0]).toMatchObject({
      table: 'agent_heartbeats',
      op: 'upsert',
      values: { name: 'verifier', last_seen_at: now.toISOString(), info: { sessions: 1, free: 2 } },
    });
    expect(rpcCalls.map((c) => c.name)).toEqual(['expire_verification_jobs', 'claim_verification_jobs']);
    expect(rpcCalls[1]?.args).toEqual({ p_limit: 2 });
    expect(storageCalls).toEqual([
      {
        bucket: 'verifier-screenshots',
        method: 'createSignedUploadUrl',
        args: ['2026-10/j1.jpg'],
      },
    ]);
  });

  it('a poll with no free session only beats', async () => {
    const { db, rpcCalls } = fakeDb();
    expect(await leaseJobs(db, { max: 0, sessions: 3 }, now)).toEqual([]);
    expect(rpcCalls.map((c) => c.name)).toEqual(['expire_verification_jobs']);
  });

  it('still hands out the job when the upload URL fails — the verdict matters more', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = fakeDb({
      'rpc.claim_verification_jobs': { data: [leased({ kind: 'evidence' })] },
      'storage.createSignedUploadUrl': { data: null, error: { message: 'nope' } },
    });
    expect(await leaseJobs(db, { max: 1, sessions: 0 }, now)).toMatchObject([
      { kind: 'evidence', upload: null },
    ]);
    error.mockRestore();
  });

  it.each([
    ['agent_heartbeats.upsert', 'agent_heartbeats: boom'],
    ['rpc.expire_verification_jobs', 'expire_verification_jobs: boom'],
    ['rpc.claim_verification_jobs', 'claim_verification_jobs: boom'],
  ])('throws when %s fails', async (key, message) => {
    const { db } = fakeDb({ [key]: { error: { message: 'boom' } } });
    await expect(leaseJobs(db, { max: 1, sessions: 0 }, now)).rejects.toThrow(message);
  });

  it('caps a poll at 3 jobs (3 sessions on the VPS, PRD §5)', () => {
    expect(leaseQuerySchema.safeParse({ max: '4' }).success).toBe(false);
    expect(leaseQuerySchema.parse({})).toEqual({ max: 1, sessions: 0 });
  });
});

describe('completeJob (POST /api/jobs)', () => {
  const input = completeJobSchema.parse({
    jobId: '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f',
    result: 'loaded',
    httpStatus: 200,
    screenshot: true,
  });

  it('records the verdict with the path the server derives, and clears the unavailable alert', async () => {
    const { db, rpcCalls } = fakeDb({
      'verification_jobs.select': { data: { id: input.jobId, created_at: '2026-09-30T23:59:59Z' } },
      'rpc.complete_verification_job': { data: [{ kind: 'verify' }] },
      'storage.exists': { data: true },
    });
    expect(await completeJob(db, input)).toEqual({ ok: true, kind: 'verify' });
    expect(rpcCalls).toEqual([
      {
        name: 'complete_verification_job',
        args: {
          p_job_id: input.jobId,
          p_result: 'loaded',
          p_http_status: 200,
          p_screenshot_path: `2026-09/${input.jobId}.jpg`,
        },
      },
    ]);
  });

  it('refuses an unknown job and an expired lease (Done-when 4)', async () => {
    const unknown = fakeDb({ 'verification_jobs.select': { data: null } });
    expect(await completeJob(unknown.db, input)).toEqual({ ok: false });
    const expired = fakeDb({
      'verification_jobs.select': { data: { id: input.jobId, created_at: '2026-10-07T03:00:00Z' } },
      'rpc.complete_verification_job': { data: [] },
    });
    expect(await completeJob(expired.db, input)).toEqual({ ok: false });
    expect(expired.rpcCalls.map((c) => c.name)).toEqual(['complete_verification_job']);
  });

  it('records no screenshot the agent didn’t upload, and passes the detail', async () => {
    const { db, rpcCalls } = fakeDb({
      'verification_jobs.select': { data: { id: input.jobId, created_at: '2026-10-07T03:00:00Z' } },
      'rpc.complete_verification_job': { data: [{ kind: 'evidence' }] },
    });
    const failed = {
      ...input,
      result: 'failed' as const,
      screenshot: false,
      detail: 'Timeout 20 s',
      httpStatus: null,
    };
    expect(await completeJob(db, failed)).toEqual({ ok: true, kind: 'evidence' });
    expect(rpcCalls[0]?.args).toEqual({
      p_job_id: input.jobId,
      p_result: 'failed',
      p_detail: 'Timeout 20 s',
    });
  });

  it.each([
    ['verification_jobs.select', 'verification_jobs: boom'],
    ['rpc.complete_verification_job', 'complete_verification_job: boom'],
  ])('throws when %s fails', async (key, message) => {
    const { db } = fakeDb({
      'verification_jobs.select': { data: { id: input.jobId, created_at: '2026-10-07T03:00:00Z' } },
      'rpc.complete_verification_job': { data: [{ kind: 'verify' }] },
      [key]: { error: { message: 'boom' } },
    });
    await expect(completeJob(db, input)).rejects.toThrow(message);
  });

  it('records no screenshot the agent claims but the bucket doesn’t have', async () => {
    const { db, rpcCalls } = fakeDb({
      'verification_jobs.select': { data: { id: input.jobId, created_at: '2026-10-07T03:00:00Z' } },
      'rpc.complete_verification_job': { data: [{ kind: 'verify' }] },
      'storage.exists': { data: false },
    });
    await completeJob(db, input);
    expect(rpcCalls[0]?.args).not.toHaveProperty('p_screenshot_path');
  });

  it('strips markup from the detail (it can reach a Chat card)', () => {
    expect(completeJobSchema.parse({ ...input, detail: '<a href="x">y</a>' }).detail).toBe('a href="x"y/a');
  });

  it('never takes a path or a location from the agent', () => {
    const parsed = completeJobSchema.parse({ ...input, screenshotPath: '../../etc/passwd' });
    expect(parsed).not.toHaveProperty('screenshotPath');
    expect(screenshotPath({ id: 'j1', created_at: '2026-10-07T03:00:00Z' })).toBe('2026-10/j1.jpg');
  });
});
