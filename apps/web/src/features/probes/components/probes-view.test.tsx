import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { beatRowsOf, probeCardsOf, summaryOf } from '../model';
import type { ProbesData } from '../queries';
import { ProbesView } from './probes-view';

const now = new Date('2026-09-25T03:07:12Z');
const ago = (s: number) => new Date(now.getTime() - s * 1000).toISOString();
const locations = { BKK: ago(2), SIN: ago(8), TYO: ago(10) };
const facts = {
  engineSweep: ago(12),
  notifier: ago(12),
  crawler: ago(600),
  verifier: ago(31),
  watchdog: ago(9),
  locations,
};
const gaps = [{ location: 'SIN', gap_start: '2026-09-24T20:12:00Z', gap_end: '2026-09-24T20:16:00Z' }];

const data = (over: Partial<ProbesData> = {}): ProbesData => {
  const beats = beatRowsOf(facts, now);
  return {
    nowIso: now.toISOString(),
    summary: summaryOf(beats),
    probes: probeCardsOf([], [], locations, now),
    beats,
    gapLines: [],
    onCallName: 'Ploy',
    admins: 1,
    pipeline: { sweepAt: ago(12), notifierAt: ago(12), delivery: { waiting: 0, sent24h: 14, failed24h: 0 } },
    verifier: {
      seenAt: ago(31),
      queue: 0,
      lastJob: { at: '2026-09-25T02:41:00Z', site: 'Tubtong', result: 'loaded' },
    },
    ...over,
  };
};

describe('ProbesView (S12a, board Probes)', () => {
  it('healthy: the summary, three probe cards, every heartbeat, who hears, pipeline and verifier', () => {
    render(<ProbesView data={data()} />);
    expect(screen.getByText('Monitor healthy · 8/8 heartbeats on time')).toBeInTheDocument();
    expect(
      screen.getByText('No probe location missed more than 3 min in the last 24 h.'),
    ).toBeInTheDocument();
    for (const t of ['BKK · Bangkok', 'SIN · Singapore', 'TYO · Tokyo'])
      expect(screen.getByText(t)).toBeInTheDocument();
    expect(screen.getAllByText('Healthy')).toHaveLength(3);
    expect(screen.getAllByText('Up')).toHaveLength(8);
    expect(screen.getByText('Email Admins + Alerts Space @on-call')).toBeInTheDocument();
    expect(screen.getByText(/@mentions the on-call person \(Ploy now\)/)).toBeInTheDocument();
    expect(screen.getByText('1 active Admin gets these emails.')).toBeInTheDocument();
    expect(screen.getByText('14 sent · 0 failed')).toBeInTheDocument();
    expect(screen.getByText('09:41 · Tubtong · passed')).toBeInTheDocument();
  });

  it('a missed heartbeat, a gap, no delivery counts (not an Admin), no verifier job yet', () => {
    const beats = beatRowsOf({ ...facts, engineSweep: ago(20 * 60), watchdog: null }, now);
    render(
      <ProbesView
        data={data({
          beats,
          summary: summaryOf(beats),
          probes: probeCardsOf([], gaps, { ...locations, TYO: null }, now),
          gapLines: [{ at: gaps[0]!.gap_end, text: 'SIN reported nothing 03:12–03:16 (4 min)' }],
          onCallName: null,
          admins: 2,
          pipeline: { sweepAt: ago(20 * 60), notifierAt: null, delivery: null },
          verifier: { seenAt: null, queue: 2, lastJob: null },
        })}
      />,
    );
    expect(screen.getByText('1 heartbeat missed · engine')).toBeInTheDocument();
    expect(
      screen.getByText(/One gap in the last 24 h: SIN reported nothing 03:12–03:16 \(4 min\)\./),
    ).toBeInTheDocument();
    expect(screen.getByText(/the other two locations kept deciding status/)).toBeInTheDocument();
    expect(screen.getByText('Down')).toBeInTheDocument();
    expect(screen.getByText('No ping yet')).toBeInTheDocument();
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.getByText('1 · 4 min')).toBeInTheDocument();
    expect(screen.getByText('Delivery counts are for Admins.')).toBeInTheDocument();
    expect(screen.getByText('2 active Admins get these emails.')).toBeInTheDocument();
    expect(screen.getByText('None yet')).toBeInTheDocument();
    expect(screen.getByText('2 (alert at > 5)')).toBeInTheDocument();
  });
});
