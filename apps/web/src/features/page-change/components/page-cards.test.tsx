import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '@jirawatpyk/aura-react';
import type { PageChangeView } from '../model';
import { PageFingerprintCard, WhatChangedCard, type IncidentAccept } from './page-cards';

const m = vi.hoisted(() => ({ refresh: vi.fn(), accept: vi.fn(), undo: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock('../actions', () => ({ acceptBaseline: m.accept, undoBaseline: m.undo }));

// Spec §26.4–§26.8 states with made-up values (never product data).
const NOW = Date.parse('2026-10-15T03:07:00Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const view = (over: Partial<PageChangeView> = {}): PageChangeView => ({
  monitorId: 'm1',
  status: 'matches',
  recordingUntil: ago(-14 * 24 * 60),
  baseline: { acceptedAt: ago(9000), acceptedBy: 'Tao', reason: null, firstSetAt: ago(30000) },
  checkedAt: ago(7),
  nextFetchAt: ago(-23),
  fingerprint: [
    { field: 'title', label: 'Page title', kind: 'text', value: 'Site A' },
    { field: 'scripts', label: 'Script / iframe domains', kind: 'domains', domains: ['static-cdn.example'] },
  ],
  rows: [],
  newScript: [],
  held: 0,
  firstSeenAt: null,
  checkId: 'c1',
  pending: null,
  incident: null,
  noData: null,
  ...over,
});
const ROWS: PageChangeView['rows'] = [
  { field: 'title', label: 'Page title', kind: 'text', was: 'Site A', now: 'Site A | สล็อตออนไลน์' },
  {
    field: 'scripts',
    label: 'Script / iframe domains',
    kind: 'domains',
    added: ['evil-cdn.example'],
    removed: ['old.example'],
    unchanged: ['static-cdn.example', 'tag.example'],
  },
];
const problem = (over: Partial<PageChangeView> = {}) =>
  view({
    status: 'problem',
    rows: ROWS,
    newScript: ['evil-cdn.example'],
    held: 1,
    firstSeenAt: ago(7),
    incident: { id: 'i1', number: 157, since: ago(37) },
    ...over,
  });
const card = (v: PageChangeView, canAccept = true) =>
  render(
    <>
      <PageFingerprintCard view={v} siteName="Site A" canAccept={canAccept} viewerName="Tao" />
      <Toaster />
    </>,
  );

afterEach(() => vi.clearAllMocks());

describe('PageFingerprintCard (§26.8)', () => {
  it('Matches: one line, "Show fingerprint" expands the baseline', () => {
    card(view());
    expect(screen.getByText(/^Matches baseline · checked/)).toBeTruthy();
    const toggle = screen.getByRole('button', { name: 'Show fingerprint' });
    expect(screen.queryByText('Baseline fingerprint')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText('Baseline fingerprint')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide fingerprint' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('Recording shows the current fingerprint at once; No data and No fingerprint say so', () => {
    const { unmount } = card(view({ status: 'recording' }));
    expect(screen.getByText('Current fingerprint')).toBeTruthy();
    unmount();
    const nodata = card(view({ status: 'no_data', noData: { reason: 'timeout', statusCode: null } }));
    expect(screen.getByText(/^Couldn’t read the page \(timed out\) · last read \d\d:\d\d$/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show fingerprint' }));
    expect(screen.getByText(/^Last fingerprint read · \d\d:\d\d$/)).toBeTruthy();
    nodata.unmount();
    card(view({ status: 'no_fingerprint', fingerprint: [] }));
    expect(screen.getByText('No fingerprint yet — the first check runs within 30 min')).toBeTruthy();
  });

  it('PROBLEM open: the rows with +/− chips and screen-reader words, the incident link, Accept for an Admin', () => {
    card(problem());
    expect(screen.getByText(/\+ evil-cdn\.example/).textContent).toBe('+ evil-cdn.example (new)');
    expect(screen.getByText(/− old\.example/).textContent).toBe('− old.example (removed)');
    expect(
      screen.getByRole('link', { name: /INC-0157 · Page change · since \d\d:\d\d/ }).getAttribute('href'),
    ).toBe('/incidents/i1');
    const more = screen.getByRole('button', { name: 'and 2 unchanged' });
    fireEvent.click(more);
    expect(screen.getByText('tag.example')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide unchanged' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accept as new baseline' })).toBeTruthy();
  });

  it('other roles get the hint, never the button', () => {
    card(problem(), false);
    expect(screen.getByText('Only an Admin can accept a new baseline')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accept as new baseline' })).toBeNull();
  });

  it('an accept inside its Undo shows the pending line and no second Accept', () => {
    card(problem({ pending: { until: ago(-0.1), byViewer: true, reason: 'x' } }));
    expect(screen.getByText(/^Accepting as the new baseline — Undo is open until/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accept as new baseline' })).toBeNull();
  });
});

describe('WhatChangedCard (§26.4)', () => {
  const what = (v: PageChangeView, accepted: IncidentAccept | null = null) =>
    render(
      <WhatChangedCard
        view={v}
        rows={ROWS}
        newScript={['evil-cdn.example']}
        incidentLabel="INC-0157"
        resolved={false}
        accepted={accepted}
        siteName="Site A"
        canAccept
        viewerName="Tao"
      />,
    );

  it('the rows it opened with, the footer and Accept while the page differs', () => {
    what(problem());
    expect(
      screen.getByText(/compared with the baseline accepted .* by Tao · 2 of 7 fields differ/),
    ).toBeTruthy();
    expect(screen.getByText(/^First seen \d\d:\d\d · held 1 check$/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accept as new baseline' })).toBeTruthy();
  });

  it.each<[string, Partial<IncidentAccept>, RegExp]>([
    [
      'before the match',
      {},
      /^Accepted as the new baseline \d\d:\d\d by Tao · the \d\d:\d\d fetch should match and recover INC-0157\.$/,
    ],
    [
      'after it',
      { matchedAt: ago(-20) },
      /^Accepted as the new baseline \d\d:\d\d by Tao · matched on the \d\d:\d\d fetch\.$/,
    ],
    [
      'with the resolve',
      { withResolve: true },
      /^Accepted as the new baseline with the resolve · \d\d:\d\d by Tao\.$/,
    ],
  ])('after an accept (%s): the success line, the rows kept, no Accept', (_n, over, line) => {
    what(problem(), { at: ago(0), by: 'Tao', withResolve: false, matchedAt: null, ...over });
    expect(screen.getByText(line)).toBeTruthy();
    expect(screen.getByText('Page title')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accept as new baseline' })).toBeNull();
  });

  it('focus follows the accept: to the pending line, then back to Accept after an Undo (WCAG 2.4.3)', () => {
    const { rerender } = what(problem());
    const props = {
      rows: ROWS,
      newScript: ['evil-cdn.example'],
      incidentLabel: 'INC-0157',
      resolved: false,
      accepted: null,
      siteName: 'Site A',
      canAccept: true,
      viewerName: 'Tao',
    };
    rerender(
      <WhatChangedCard
        view={problem({ pending: { until: ago(-0.1), byViewer: true, reason: 'x' } })}
        {...props}
      />,
    );
    expect(screen.getByText(/^Accepting as the new baseline — Undo is open until/)).toHaveFocus();
    rerender(<WhatChangedCard view={problem()} {...props} />);
    expect(screen.getByRole('button', { name: 'Accept as new baseline' })).toHaveFocus();
  });
});

describe('Accept as new baseline (§26.5–§26.6)', () => {
  it('the dialog warns on a new script domain, needs a reason, accepts, and Undo takes it back', async () => {
    m.accept.mockResolvedValue({ ok: true, appliesAt: new Date(Date.now() + 10_000).toISOString() });
    m.undo.mockResolvedValue({ ok: true });
    card(problem());
    fireEvent.click(screen.getByRole('button', { name: 'Accept as new baseline' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Accept the current page as the new baseline?',
    });
    expect(dialog.textContent).toContain('A new script domain usually means injected code.');
    expect(dialog.textContent).toContain('New: evil-cdn.example.');
    // the Reason field takes focus when the dialog opens (§26.5)
    await waitFor(() => expect(screen.getByLabelText(/^Reason/)).toHaveFocus());
    expect(dialog.textContent).toContain('Page title: Site A | สล็อตออนไลน์');
    expect(dialog.textContent).toContain('Script / iframe domains: + evil-cdn.example, − old.example');
    const confirm = screen.getByRole('button', { name: 'Accept as baseline' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'Client added it' } });
    await act(async () => fireEvent.click(confirm));
    expect(m.accept).toHaveBeenCalledWith({ checkId: 'c1', reason: 'Client added it' });
    expect(await screen.findByText('Accepting as the new baseline')).toBeTruthy();
    expect(screen.getByText(/^Applies in \d+ s — nothing changes until then$/)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Undo · \d+ s$/ })));
    expect(m.undo).toHaveBeenCalledWith('m1');
    expect(await screen.findByText('Undone — the baseline is unchanged')).toBeTruthy();
  });

  it('a refusal stays in the dialog under the reason', async () => {
    m.accept.mockResolvedValue({ ok: false, message: 'A new baseline is already waiting to apply' });
    card(problem({ newScript: [] }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept as new baseline' }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'x' } });
    const confirm = screen.getByRole('button', { name: 'Accept as baseline' });
    await act(async () => fireEvent.click(confirm));
    await waitFor(() => expect(screen.getByText('A new baseline is already waiting to apply')).toBeTruthy());
    expect(screen.queryByText('A new script domain usually means injected code.')).toBeNull();
  });
});
