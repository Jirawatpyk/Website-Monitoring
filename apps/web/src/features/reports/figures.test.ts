import { describe, expect, it } from 'vitest';
import {
  buildFigures,
  causesOf,
  needsRootCause,
  parseFigures,
  type FigureIncident,
  type FigureInputs,
} from './figures';
import { incidentNote, pdfModel, reportId, rowWords } from './words';

// S20 Done-when 1: spec §5 "September so far" (to Fri 25 Sep 10:07 Bangkok) through the rows the
// database gives (incidents + their events), the page's row words and the PDF's. Times are UTC.
const NOW = new Date('2026-09-25T03:07:00Z');
const plus = (iso: string, min: number) => new Date(Date.parse(iso) + min * 60_000).toISOString();

let n = 0;
/** One DOWN incident: detected at its start, recovered after `min` (null = still down). */
function down(
  siteId: string,
  start: string,
  min: number | null,
  extra: Partial<FigureIncident> = {},
): FigureIncident {
  return {
    siteId,
    number: ++n,
    severity: 'down',
    trigger: 'hard_fail',
    startedAt: start,
    resolvedAt: min === null ? null : plus(start, min + 30),
    rootCauseCategory: 'hosting',
    rootCause: 'Hosting provider network fault.',
    events: [
      { type: 'detected', at: start, payload: { trigger: 'hard_fail' } },
      ...(min === null ? [] : [{ type: 'recovered', at: plus(start, min), payload: {} }]),
    ],
    ...extra,
  };
}
function problem(
  siteId: string,
  start: string,
  min: number,
  trigger: FigureIncident['trigger'],
): FigureIncident {
  return {
    siteId,
    number: ++n,
    severity: 'problem',
    trigger,
    startedAt: start,
    resolvedAt: plus(start, min + 30),
    rootCauseCategory: 'app',
    rootCause: null,
    events: [
      { type: 'detected', at: start, payload: {} },
      { type: 'recovered', at: plus(start, min), payload: {} },
    ],
  };
}

const site = (id: string, name: string, tier: 1 | 2 | 3) => ({
  id,
  name,
  tier,
  monitoringStartedAt: new Date('2026-07-01T00:00:00Z'),
});

function inputs(
  client: string,
  sites: ReturnType<typeof site>[],
  incidents: FigureIncident[],
  extra: Partial<FigureInputs> = {},
): FigureInputs {
  return {
    monthKey: '2026-09',
    now: NOW,
    client: { name: client, am: 'Account Manager' },
    sites,
    incidents,
    maintenance: new Map(),
    stopped: new Map(),
    response: [],
    ...extra,
  };
}

const ba = inputs(
  'Bangkok Airways',
  [site('tw', 'Bangkok Airways – Taiwan', 1), site('cn', 'Bangkok Airways – China', 1)],
  [
    down('tw', '2026-09-03T07:06:00Z', 11),
    problem('tw', '2026-09-10T02:00:00Z', 600, 'ssl'), // internal: not listed, not counted
    problem('cn', '2026-09-18T03:05:00Z', 14, 'slow'),
  ],
  {
    response: [
      { siteId: 'tw', checks: 1000, p50: 400, p95: 700 },
      { siteId: 'cn', checks: 1000, p50: 680, p95: 1200 },
      { siteId: 'cn', checks: 10, p50: 9000, p95: 9000 },
    ],
  },
);
const muvmi = inputs(
  'MuvMi',
  [site('mv', 'MuvMi', 1)],
  [
    down('mv', '2026-09-05T01:00:00Z', 30),
    {
      ...down('mv', '2026-09-12T01:00:00Z', 20),
      events: [
        { type: 'detected', at: '2026-09-12T01:00:00Z', payload: {} },
        { type: 'recovered', at: '2026-09-12T01:20:00Z', payload: {} },
        {
          type: 'relapsed',
          at: '2026-09-12T02:01:00Z',
          payload: { startedAt: '2026-09-12T02:00:00Z', severity: 'down', trigger: 'hard_fail' },
        },
        { type: 'recovered', at: '2026-09-12T02:10:00Z', payload: {} },
      ],
    },
    down('mv', '2026-09-25T02:26:00Z', null, { rootCauseCategory: null, rootCause: null }),
    down('mv', '2026-09-20T01:00:00Z', 15, { rootCauseCategory: 'false_alarm' }),
  ],
);
const cando = inputs('Cando Asia', [site('ca', 'Cando Asia', 2)], [down('ca', '2026-09-08T04:00:00Z', 12)]);
const orca = inputs(
  'ORCA Thailand',
  [site('or', 'ORCA Thailand', 2)],
  [down('or', '2026-09-14T09:00:00Z', 8)],
);

describe('spec §5 September so far — the page row and the PDF (S20 Done-when 1)', () => {
  it.each([
    ['BA', ba, '99.98%', '11 min', '2', '1 outage, 1 degraded'],
    ['MuvMi', muvmi, '99.71%', '1 h 41 min', '3', '3 outages, 1 open'],
    ['Cando', cando, '99.97%', '12 min', '1', '1 outage'],
    ['ORCA', orca, '99.98%', '8 min', '1', '1 outage'],
  ] as const)('%s: %s, %s down, %s incidents (%s)', (_c, input, uptime, down, count, note) => {
    const f = buildFigures(input);
    const row = rowWords(f);
    expect([row.uptime, row.down, row.incidents, row.incidentNote]).toEqual([uptime, down, count, note]);
    const pdf = pdfModel(f);
    expect(pdf.tiles.map((t) => t.value)).toEqual([uptime, down, count, expect.any(String)]);
  });

  it('BA: the internal SSL PROBLEM is absent from the page, the PDF lines and the day cells', () => {
    const f = buildFigures(ba);
    expect(f.incidents.map((i) => [i.site, i.kind, i.trigger, i.minutes])).toEqual([
      ['Bangkok Airways – China', 'degraded', 'slow', 14],
      ['Bangkok Airways – Taiwan', 'outage', 'hard_fail', 11],
    ]);
    const pdf = pdfModel(f);
    expect(pdf.incidents.map((i) => i.line)).toEqual([
      'Bangkok Airways – China — slow to respond',
      'Bangkok Airways – Taiwan — site down',
    ]);
    expect(JSON.stringify(pdf)).not.toMatch(/ssl/i);
    expect(pdf.sites[1]!.days[9]!.kind).toBe('ok'); // 10 Sep: the SSL warning only
    expect(pdf.sites[0]!.days[17]!.kind).toBe('degraded'); // 18 Sep
    expect(pdf.tiles[1]!.caption).toBe('1 outage, Bangkok Airways – Taiwan');
    expect(pdf.tiles[2]!.caption).toBe('1 outage · 1 degraded');
  });

  it('BA: response is the checks-weighted median of the days (D-073 item 10)', () => {
    const f = buildFigures(ba);
    expect(f.sites.map((s) => [s.p50, s.p95])).toEqual([
      [680, 1200],
      [400, 700],
    ]);
    expect(pdfModel(f).table.map((r) => [r.p50, r.p95])).toEqual([
      ['680 ms', '1.2 s'],
      ['400 ms', '700 ms'],
    ]);
  });

  it('MuvMi: the open outage counts to now, the false alarm is left out, the gate holds', () => {
    const f = buildFigures(muvmi);
    expect(f.incidents.map((i) => [i.minutes, i.open])).toEqual([
      [41, true],
      [30, false],
      [30, false],
    ]);
    expect(needsRootCause(f)).toBe(true);
    expect(rowWords(f).needsRootCause).toBe(true);
    expect(pdfModel(f).incidents[0]!.duration).toBe('41 min · still ongoing');
  });

  it('a target is the tier’s own (D-073 item 5); a running month says PREVIEW', () => {
    const pdf = pdfModel(buildFigures(cando));
    expect(pdf.tiles[0]!.caption).toBe('Target 99.90% met');
    expect(pdf.eyebrow).toBe('PREVIEW · MONTHLY UPTIME REPORT · 1–25 SEP 2026 · THAILAND TIME (UTC+7)');
    expect(pdfModel(buildFigures(muvmi)).tiles[0]!.caption).toBe('Target 99.95% missed');
  });
});

describe('figures are stored and read back (D-073 item 11)', () => {
  it('a built month parses; an older or broken shape is null', () => {
    const f = buildFigures(orca);
    expect(parseFigures(JSON.parse(JSON.stringify(f)))).toEqual(f);
    expect(parseFigures({ ...f, v: 2 })).toBeNull();
    expect(parseFigures({ uptime: 0.9997 })).toBeNull();
  });
});

describe('causesOf (D-067)', () => {
  const base = problem('x', '2026-09-01T00:00:00Z', 60, 'ssl');
  it('detected without a trigger: the first change’s `was`, then each change', () => {
    const inc: FigureIncident = {
      ...base,
      trigger: 'ssl',
      events: [
        { type: 'detected', at: '2026-09-01T00:01:00Z', payload: {} },
        { type: 'new_cause', at: '2026-09-01T00:20:00Z', payload: { trigger: 'ssl', was: 'slow' } },
      ],
    };
    expect(causesOf(inc).map((c) => c.trigger)).toEqual(['slow', 'ssl']);
  });
  it('no events: the incident’s own trigger from its start', () => {
    const c = causesOf({ ...base, events: [] });
    expect(c).toEqual([{ at: new Date('2026-09-01T00:00:00Z'), trigger: 'ssl' }]);
  });
});

describe('words', () => {
  it.each([
    [{ outages: 0, degraded: 0, open: 0 }, ''],
    [{ outages: 0, degraded: 1, open: 1 }, '1 degraded, open'],
    [{ outages: 2, degraded: 0, open: 0 }, '2 outages'],
  ])('incidentNote %j → %s', (f, want) => {
    expect(incidentNote(f)).toBe(want);
  });
  it('report ids: initials, or a single name’s first three letters', () => {
    const f = buildFigures(ba);
    expect(reportId(f)).toBe('RPT-2609-BA');
    expect(reportId({ ...f, client: { name: 'ENEOS', am: null } })).toBe('RPT-2609-ENE');
  });
});
