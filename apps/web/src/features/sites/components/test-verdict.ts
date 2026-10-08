import type { TestCheckResult } from '../types';

export type RowLook = 'pass' | 'blocked' | 'fail' | 'waiting';

/** One location's line in the Test check card. */
export function describeResult(r: TestCheckResult, keywords: number): { text: string; look: RowLook } {
  if (r.outcome === 'refused') return { text: 'Not allowed · private address', look: 'fail' };
  if (r.outcome === 'blocked') return { text: `${r.statusCode ?? 403} · bot challenge`, look: 'blocked' };
  if (r.outcome === 'fail') {
    return {
      text: `Hard fail · ${r.statusCode ? `HTTP ${r.statusCode}` : (r.error ?? 'no answer')}`,
      look: 'fail',
    };
  }
  const missing = (r.keywordMissing?.length ?? 0) > 0;
  const forbidden = (r.keywordForbidden?.length ?? 0) > 0;
  const kw =
    keywords === 0 && !forbidden
      ? 'no keyword set'
      : missing
        ? 'keyword missing'
        : forbidden
          ? 'forbidden text found'
          : 'keyword found';
  return { text: `HTTP ${r.statusCode} · ${kw}`, look: missing || forbidden ? 'fail' : 'pass' };
}

/** "1.2 s" / "412 ms". */
export function formatResponse(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * What the scheduled checks would make of these results, in the engine's words: a hard fail at one
 * location never makes DOWN on its own; a bot challenge goes to the browser verifier.
 */
export function testVerdict(results: TestCheckResult[], keyword: string): { title: string; note: string } {
  const quoted = keyword ? `“${keyword}”` : 'The brand keyword';
  if (results.some((r) => r.outcome === 'refused')) {
    return {
      title: 'Not allowed.',
      note: 'This address points inside a private network — monitors check public sites only.',
    };
  }
  const fails = results.filter((r) => r.outcome === 'fail').length;
  if (fails === results.length) {
    return {
      title: 'Would be: DOWN.',
      note: 'Every location tested got a hard fail. Nothing is stored or alerted until monitoring starts.',
    };
  }
  if (results.some((r) => r.outcome === 'blocked')) {
    return {
      title: 'Would be: checked in the browser.',
      note: 'A bot challenge answered — the browser verifier decides. Allowlist the probes to stop relying on it.',
    };
  }
  if (fails > 0) {
    return {
      title: 'Would be: OK for now.',
      note: 'One location failed; one location alone never makes the site DOWN. Run again to see if it holds.',
    };
  }
  if (results.some((r) => (r.keywordMissing?.length ?? 0) > 0)) {
    return { title: 'Would be: PROBLEM (Keyword).', note: `${quoted} isn’t on the page.` };
  }
  const forbidden = [...new Set(results.flatMap((r) => r.keywordForbidden ?? []))];
  if (forbidden.length) {
    return {
      title: 'Would be: PROBLEM (Keyword).',
      note: `Forbidden text is on the page: ${forbidden.join(', ')}.`,
    };
  }
  const n = results.length;
  return {
    title: 'Would be: OK.',
    note: `${n} of ${n} locations pass${keyword ? ` and ${quoted} is on the page` : ''}. Nothing is stored or alerted until monitoring starts.`,
  };
}
