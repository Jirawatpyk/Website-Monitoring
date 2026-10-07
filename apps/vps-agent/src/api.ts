import type { IngestBatch } from '@dxt/shared';

/** A monitor the Ingest API says is due this minute. */
export interface DueMonitor {
  id: string;
  url: string;
  method: 'GET' | 'HEAD';
  timeoutMs: number;
}

/** A verification job leased from the Job API (60 s lease). */
export interface LeasedJob {
  id: string;
  kind: 'verify' | 'evidence';
  url: string;
  mustContain: string[];
  /** One PUT of a JPEG here stores the screenshot; null when the server couldn't sign one. */
  upload: { url: string; path: string } | null;
}

export interface Verdict {
  jobId: string;
  /** blocked = the browser got a WAF / challenge page too (D-020). */
  result: 'loaded' | 'failed' | 'blocked';
  detail: string | null;
  httpStatus: number | null;
  screenshot: boolean;
}

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
  postResults(results: IngestBatch['results']): Promise<void>;
  leaseJobs(max: number, sessions: number): Promise<LeasedJob[]>;
  /** False when the lease ran out (409): the result no longer counts. */
  completeJob(verdict: Verdict): Promise<boolean>;
}

const TIMEOUT_MS = 15_000;

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
  const json = async <T>(route: string, init?: RequestInit): Promise<T> => {
    const res = await call(route, init);
    if (!res.ok) throw new ApiError(route.split('?')[0]!, res.status);
    return (await res.json()) as T;
  };

  return {
    async dueMonitors() {
      return (await json<{ monitors: DueMonitor[] }>('/api/ingest')).monitors;
    },
    async postResults(results) {
      await json('/api/ingest', { method: 'POST', body: JSON.stringify({ results }) });
    },
    async leaseJobs(max, sessions) {
      return (await json<{ jobs: LeasedJob[] }>(`/api/jobs?max=${max}&sessions=${sessions}`)).jobs;
    },
    async completeJob(verdict) {
      const res = await call('/api/jobs', { method: 'POST', body: JSON.stringify(verdict) });
      if (res.status === 409) return false;
      if (!res.ok) throw new ApiError('/api/jobs', res.status);
      return true;
    },
  };
}
