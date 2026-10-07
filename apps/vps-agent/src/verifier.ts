import { assertPublicTarget, classifyResponse, TargetNotAllowedError, type Lookup } from '@dxt/probe';
import type { Api, LeasedJob, Verdict } from './api';

/** PRD §5: 20 s per page. */
export const PAGE_TIMEOUT_MS = 20_000;
/** Page 20 s + screenshot 5 s + upload 10 s + report 10 s stays inside the 60 s lease. */
const UPLOAD_TIMEOUT_MS = 10_000;

/** What one page visit saw. */
export interface PageVisit {
  /** Status of the last main-document response (after any challenge redirect), or null. */
  status: number | null;
  /** That response's headers, lower-case names. */
  headers: Record<string, string>;
  /** The page's HTML after it loaded. */
  html: string;
  screenshot: Uint8Array | null;
}

/** A plain browser (no stealth: if Chromium is blocked, real visitors may be too — PRD §5). */
export interface PageBrowser {
  visit(url: string, timeoutMs: number): Promise<PageVisit>;
}

/**
 * Loaded = the page answered below 400 and every keyword the monitor expects is there. A WAF or
 * challenge page in the browser too is `blocked` → PROBLEM, never DOWN (D-020); anything else that
 * isn't loaded is `failed` → DOWN (StatusModel "page fails").
 */
export function judgeVisit(
  visit: PageVisit,
  mustContain: readonly string[],
): Pick<Verdict, 'result' | 'detail'> {
  if (visit.status === null) return { result: 'failed', detail: 'No response' };
  // The same rule as the HTTP probes (D-020): what they call blocked, the browser calls blocked.
  const seen = {
    status: visit.status,
    headers: new Headers(visit.headers),
    bodySample: visit.html.slice(0, 16_384),
  };
  if (classifyResponse(seen) === 'blocked') {
    return { result: 'blocked', detail: `Bot protection in the browser too (HTTP ${visit.status})` };
  }
  if (visit.status >= 400) return { result: 'failed', detail: `HTTP ${visit.status}` };
  const missing = mustContain.find((k) => !visit.html.includes(k));
  if (missing !== undefined) return { result: 'failed', detail: `Keyword missing: ${missing.slice(0, 100)}` };
  return { result: 'loaded', detail: null };
}

/** Why the visit itself failed, short and without internals. */
function describeVisitError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/timeout/i.test(message)) return `Page didn’t load in ${PAGE_TIMEOUT_MS / 1000} s`;
  return message.split('\n')[0]!.slice(0, 200);
}

export interface VerifyDeps {
  api: Api;
  browser: PageBrowser;
  fetchImpl?: typeof fetch;
  /** DNS for the SSRF guard (tests). */
  lookup?: Lookup;
}

/**
 * One job: open the page, judge it, upload the screenshot to the signed URL the lease came with,
 * and report. Returns whether the server took the verdict (false after the lease ran out).
 */
export async function verifyJob(
  job: LeasedJob,
  { api, browser, fetchImpl = fetch, lookup }: VerifyDeps,
): Promise<boolean> {
  let verdict: Pick<Verdict, 'result' | 'detail' | 'httpStatus'>;
  let screenshot: Uint8Array | null = null;
  try {
    // Same SSRF guard as the HTTP probes before the browser opens anything (redirects and page
    // requests are kept off private ranges by the systemd unit's IPAddressDeny).
    await assertPublicTarget(new URL(job.url), lookup);
    const visit = await browser.visit(job.url, PAGE_TIMEOUT_MS);
    verdict = { ...judgeVisit(visit, job.mustContain), httpStatus: visit.status };
    screenshot = visit.screenshot;
  } catch (err) {
    const detail = err instanceof TargetNotAllowedError ? 'Target not allowed' : describeVisitError(err);
    verdict = { result: 'failed', detail, httpStatus: null };
  }

  let uploaded = false;
  if (screenshot && job.upload) {
    try {
      const res = await fetchImpl(job.upload.url, {
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg' },
        body: screenshot,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
      uploaded = res.ok;
      if (!res.ok)
        console.warn(JSON.stringify({ event: 'screenshot_upload_failed', job: job.id, status: res.status }));
    } catch {
      console.warn(JSON.stringify({ event: 'screenshot_upload_failed', job: job.id }));
    }
  }

  const accepted = await api.completeJob({ jobId: job.id, ...verdict, screenshot: uploaded });
  console.info(
    JSON.stringify({ event: 'verified', job: job.id, kind: job.kind, result: verdict.result, accepted }),
  );
  return accepted;
}

export interface VerifierPool {
  /** One poll: lease as many jobs as there are free sessions and start them. */
  poll(): Promise<number>;
  /** Jobs still running. */
  readonly active: number;
  /** Wait for every running job (shutdown). */
  drain(): Promise<void>;
}

/** At most `maxSessions` pages at once (PRD §5: 3 sessions; staging runs 1, D-019). */
export function createVerifierPool(deps: VerifyDeps, maxSessions: number): VerifierPool {
  const running = new Set<Promise<void>>();
  return {
    get active() {
      return running.size;
    },
    async poll() {
      // Every poll beats, even with no free session: the engine counts a silent verifier unavailable.
      const jobs = await deps.api.leaseJobs(Math.max(0, maxSessions - running.size), running.size);
      for (const job of jobs) {
        const work: Promise<void> = verifyJob(job, deps)
          .then(() => undefined)
          .catch((err: unknown) => {
            console.error(JSON.stringify({ event: 'verify_failed', job: job.id, error: String(err) }));
          })
          .finally(() => running.delete(work));
        running.add(work);
      }
      return jobs.length;
    },
    async drain() {
      await Promise.allSettled([...running]);
    },
  };
}
