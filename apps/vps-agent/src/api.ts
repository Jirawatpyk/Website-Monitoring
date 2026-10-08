import {
  dueMonitorsResponseSchema,
  leasedJobsResponseSchema,
  type DueMonitor,
  type IngestBatch,
  type LeasedJob,
  type Verdict,
} from '@dxt/shared';
import type { z } from 'zod';

export type { DueMonitor, LeasedJob, Verdict };

export class ApiError extends Error {
  constructor(
    readonly route: string,
    readonly status: number,
  ) {
    super(`${route} answered ${status}`);
  }
}

export interface Api {
  dueMonitors(): Promise<DueMonitor[]>;
  postResults(results: IngestBatch['results'], control?: IngestBatch['control']): Promise<void>;
  leaseJobs(max: number, sessions: number): Promise<LeasedJob[]>;
  /** False when the lease ran out (409): the result no longer counts. */
  completeJob(verdict: Verdict): Promise<boolean>;
}

/** Each call; a verdict must land inside its 60 s lease (verifier.ts). */
const TIMEOUT_MS = 10_000;

/**
 * The only way the agent talks to DxT Monitor: the Ingest and Job APIs with INGEST_TOKEN (PRD §10).
 * The token is sent only to API_BASE_URL (https, checked in config) and never logged.
 */
export function createApi(baseUrl: string, token: string, fetchImpl: typeof fetch = fetch): Api {
  const call = async (route: string, init: RequestInit = {}) => {
    const res = await fetchImpl(new URL(route, baseUrl), {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res;
  };
  /** A response is checked against the shared schema: a server change can't turn into a silent misread. */
  const json = async <S extends z.ZodType>(
    route: string,
    schema: S,
    init?: RequestInit,
  ): Promise<z.infer<S>> => {
    const res = await call(route, init);
    if (!res.ok) throw new ApiError(route.split('?')[0]!, res.status);
    return schema.parse(await res.json());
  };

  return {
    async dueMonitors() {
      return (await json('/api/ingest', dueMonitorsResponseSchema)).monitors;
    },
    async postResults(results, control) {
      const res = await call('/api/ingest', { method: 'POST', body: JSON.stringify({ results, control }) });
      if (!res.ok) throw new ApiError('/api/ingest', res.status);
    },
    async leaseJobs(max, sessions) {
      return (await json(`/api/jobs?max=${max}&sessions=${sessions}`, leasedJobsResponseSchema)).jobs;
    },
    async completeJob(verdict) {
      const res = await call('/api/jobs', { method: 'POST', body: JSON.stringify(verdict) });
      if (res.status === 409) return false;
      if (!res.ok) throw new ApiError('/api/jobs', res.status);
      return true;
    },
  };
}
