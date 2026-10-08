'use client';

import { useState } from 'react';
import { Button, Card } from '@jirawatpyk/aura-react';
import {
  IconArrowRight,
  IconCircle,
  IconCircleAlert,
  IconCircleCheck,
  IconLock,
  IconRotateCcw,
} from '@jirawatpyk/aura-react/icons';
import { formatTimeWithSeconds } from '@dxt/shared';
import type { TestCheckInput } from '../schemas';
import type { TestCheckResult } from '../types';
import { describeResult, formatResponse, testVerdict, type RowLook } from './test-verdict';

const LOOK: Record<RowLook, { icon: React.ReactNode; className: string; label: string }> = {
  pass: { icon: <IconCircleCheck />, className: 'text-fg-positive', label: 'Pass' },
  blocked: { icon: <IconLock />, className: 'text-fg-secondary', label: 'Blocked' },
  fail: { icon: <IconCircleAlert />, className: 'text-fg-danger', label: 'Fail' },
  waiting: { icon: <IconCircle />, className: 'text-fg-tertiary', label: 'Not run' },
};

interface TestCheckCardProps {
  /** The monitor's current (unsaved) settings. */
  request: TestCheckInput;
  title?: string;
}

/**
 * Test check (AddSite) / Test before saving (EditMonitors): one check from SIN and one from TYO with
 * the settings on screen; BKK runs on the first round, because the VPS only pulls work (D-025).
 * Nothing is stored or alerted.
 */
export function TestCheckCard({ request, title = 'Test check' }: TestCheckCardProps) {
  const [results, setResults] = useState<TestCheckResult[] | null>(null);
  const [ranAt, setRanAt] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setFailure(null);
    try {
      const answers = await Promise.all(
        (['sin', 'tyo'] as const).map(async (loc) => {
          const res = await fetch(`/api/monitor-test/${loc}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(request),
          });
          if (res.status === 400) throw new TestError('Fill in a full http(s) URL and valid settings first.');
          if (res.status === 401 || res.status === 403) throw new TestError('Only an Admin can run a test.');
          if (!res.ok) throw new TestError('Couldn’t run the test. Try again.');
          return (await res.json()) as TestCheckResult;
        }),
      );
      setResults(answers);
      setRanAt(formatTimeWithSeconds(new Date()));
    } catch (err) {
      setFailure(err instanceof TestError ? err.message : 'Couldn’t run the test. Try again.');
    } finally {
      setRunning(false);
    }
  };

  const keyword = request.mustContain?.[0] ?? '';
  const verdict = results ? testVerdict(results, keyword) : null;
  return (
    <Card
      title={title}
      headingLevel={2}
      actions={
        <span className="flex items-center gap-2">
          {ranAt && <span className="font-mono text-xs text-fg-tertiary">Ran {ranAt}</span>}
          <Button
            variant={results ? 'ghost' : 'secondary'}
            size="sm"
            icon={results ? <IconRotateCcw /> : <IconArrowRight />}
            loading={running}
            disabled={!request.url}
            onClick={run}
          >
            {results ? 'Run again' : 'Run test now'}
          </Button>
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        <span className="text-sm text-fg-secondary">
          Runs once from SIN and TYO with the settings above; BKK checks on the first round. Nothing is stored
          or alerted.
        </span>
        {failure && (
          <span role="alert" className="text-sm text-fg-danger">
            {failure}
          </span>
        )}
        {results ? (
          <>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              <Row loc="BKK" look="waiting" text="Runs from BKK on the first round" time="" />
              {results.map((r) => {
                const d = describeResult(r, request.mustContain?.length ?? 0);
                return (
                  <Row
                    key={r.location}
                    loc={r.location}
                    look={d.look}
                    text={d.text}
                    time={formatResponse(r.responseMs)}
                  />
                );
              })}
            </ul>
            {verdict && (
              <div
                role="status"
                className="rounded-aura-sm border border-border-default bg-bg-canvas px-3.5 py-3 text-sm leading-normal"
              >
                <span className="font-semibold">{verdict.title}</span> {verdict.note}
              </div>
            )}
          </>
        ) : (
          <div className="rounded-aura-sm border border-dashed border-border-default px-3.5 py-3 text-sm text-fg-secondary">
            No test run yet for this monitor.
          </div>
        )}
      </div>
    </Card>
  );
}

class TestError extends Error {}

function Row({ loc, look, text, time }: { loc: string; look: RowLook; text: string; time: string }) {
  const l = LOOK[look];
  return (
    <li className="flex items-center gap-2.5 text-sm">
      <span className={`flex [&_svg]:size-4 ${l.className}`} role="img" aria-label={l.label}>
        {l.icon}
      </span>
      <span className="w-9 font-semibold">{loc}</span>
      <span className="grow">{text}</span>
      <span className="text-fg-secondary tabular-nums">{time}</span>
    </li>
  );
}
