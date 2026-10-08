import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MonitorRecord, SiteListRow } from '../types';
import { MonitorsEditor } from './monitors-editor';
import { PhraseList } from './phrase-list';
import { SitesTable } from './sites-table';
import { TestCheckCard } from './test-check-card';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }) }));
const actions = vi.hoisted(() => ({ saveMonitors: vi.fn() }));
vi.mock('../actions', () => actions);

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const row = (over: Partial<SiteListRow>): SiteListRow => ({
  id: 's1',
  name: 'EQHO',
  tier: 2,
  live: true,
  client: { id: 'c1', name: 'Internal', internal: true },
  owner: { id: 'u1', name: 'Nok' },
  status: 'ok',
  checkedAt: '2026-10-08T03:01:05Z',
  url: 'https://eqho.example.com/',
  ...over,
});

describe('SitesTable', () => {
  const sites = [
    row({}),
    row({
      id: 's2',
      name: 'Cando',
      tier: 1,
      client: { id: 'c2', name: 'Cando Asia', internal: false },
      owner: { id: 'u2', name: 'Arm' },
      status: 'down',
    }),
    row({ id: 's3', name: 'New one', live: false, status: null, checkedAt: null, url: null, owner: null }),
  ];

  it('shows status, a Draft badge and a Visit site link that opens a new tab', () => {
    render(<SitesTable sites={sites} canEdit />);
    expect(screen.getAllByText('OK').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Down').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Draft · not monitored').length).toBeGreaterThan(0);
    const visit = screen.getAllByRole('link', { name: 'Visit site: EQHO (opens in a new tab)' })[0]!;
    expect(visit).toHaveAttribute('href', 'https://eqho.example.com/');
    expect(visit).toHaveAttribute('target', '_blank');
    expect(screen.queryByRole('link', { name: /Visit site: New one/ })).not.toBeInTheDocument();
  });

  it('filters by tier and says when nothing matches', () => {
    render(<SitesTable sites={sites} canEdit={false} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Tier 3' }));
    expect(screen.getByText('No sites match these filters.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Tier 1' }));
    expect(screen.getAllByText('Cando').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('EQHO')).toHaveLength(0);
  });
});

describe('PhraseList', () => {
  it('adds on Enter or Add, ignores repeats, removes a chip, refuses an invalid entry', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PhraseList
        title="Hosts"
        addLabel="Add host"
        placeholder="x"
        phrases={['a.com']}
        onChange={onChange}
        hint="h"
        clean={(v) => (v.includes('.') ? v : null)}
      />,
    );
    const field = screen.getByLabelText('Add host');
    fireEvent.change(field, { target: { value: 'b.com' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(['a.com', 'b.com']);
    fireEvent.change(field, { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to Hosts' }));
    expect(screen.getByText('“nope” isn’t valid here')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove a.com' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    rerender(
      <PhraseList
        title="P"
        addLabel="Add phrase"
        placeholder="x"
        phrases={['A']}
        onChange={onChange}
        hint="h"
        locked="Shared"
      />,
    );
    fireEvent.change(screen.getByLabelText('Add phrase'), { target: { value: 'A' } });
    fireEvent.keyDown(screen.getByLabelText('Add phrase'), { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith([]); // unchanged: "A" already there
    expect(screen.getByText('Shared')).toBeInTheDocument();
  });
});

describe('TestCheckCard', () => {
  const pass = (location: string) => ({
    location,
    outcome: 'pass',
    statusCode: 200,
    responseMs: 795,
    keywordMissing: [],
    keywordForbidden: [],
    error: null,
  });

  it('runs SIN and TYO with the form’s settings and words the verdict', async () => {
    const fetchMock = vi.fn(
      async (url: string, _init?: RequestInit) =>
        new Response(JSON.stringify(pass(url.endsWith('sin') ? 'SIN' : 'TYO'))),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<TestCheckCard request={{ url: 'https://example.com', mustContain: ['Example Domain'] }} />);
    expect(screen.getByText('No test run yet for this monitor.')).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Run test now' })));
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/monitor-test/sin', '/api/monitor-test/tyo']);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toMatchObject({
      url: 'https://example.com',
    });
    expect(screen.getByText('Runs from BKK on the first round')).toBeInTheDocument();
    expect(screen.getAllByText('HTTP 200 · keyword found')).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent('Would be: OK.');
    expect(screen.getByRole('button', { name: 'Run again' })).toBeInTheDocument();
  });

  it.each([
    [400, 'Fill in a full http(s) URL and valid settings first.'],
    [403, 'Only an Admin can run a test.'],
    [500, 'Couldn’t run the test. Try again.'],
  ])('a %i says what to do', async (status, message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status })),
    );
    render(<TestCheckCard request={{ url: 'https://example.com' }} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Run test now' })));
    expect(screen.getByRole('alert')).toHaveTextContent(message);
  });

  it('a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    );
    render(<TestCheckCard request={{ url: 'https://example.com' }} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Run test now' })));
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t run the test. Try again.');
  });
});

describe('MonitorsEditor (EditMonitors)', () => {
  const monitor = (over: Partial<MonitorRecord>): MonitorRecord => ({
    id: 'p',
    isPrimary: true,
    url: 'https://eqho.example.com/',
    method: 'GET',
    timeoutSec: 30,
    mustContain: ['EQHO'],
    mustNotContain: [],
    allowedRedirectDomains: [],
    slowMs: null,
    headers: [],
    enabled: true,
    ...over,
  });
  const monitors = [
    monitor({}),
    monitor({ id: 'k', isPrimary: false, url: 'https://eqho.example.com/booking', mustContain: [] }),
  ];
  const renderEditor = (saved = false) =>
    render(
      <MonitorsEditor
        siteId="s1"
        siteName="EQHO"
        tier={2}
        ownerName="Nok"
        backupName="Ploy"
        monitors={monitors}
        breadcrumb={null}
        meta="Tier 2"
        saved={saved}
      />,
    );

  it('nothing to save until something changes; then counts it and saves', async () => {
    actions.saveMonitors.mockResolvedValue({ ok: true, siteId: 's1' });
    renderEditor();
    expect(screen.getByRole('button', { name: 'No changes' })).toBeDisabled();
    expect(screen.getByText('Always on')).toBeInTheDocument();
    expect(screen.getByLabelText('Slow when p50 is over')).toHaveValue('');
    expect(screen.getByText('Empty = the Tier 2 default, 5000 ms')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Timeout'), { target: { value: '20' } });
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Edited, not saved' })).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save changes' })));
    expect(actions.saveMonitors).toHaveBeenCalledWith({
      siteId: 's1',
      upserts: [expect.objectContaining({ id: 'p', timeoutSec: 20 })],
      removals: [],
    });
    expect(replace).toHaveBeenCalledWith('/sites/s1/monitors?saved=1');
  });

  it('shows a refusal next to the field it is about', async () => {
    actions.saveMonitors.mockResolvedValue({
      ok: false,
      message: 'This address points inside a private network — monitors check public sites only',
      fieldErrors: {
        'upserts.0.url': 'This address points inside a private network — monitors check public sites only',
      },
    });
    renderEditor();
    fireEvent.change(screen.getByLabelText(/^URL/), { target: { value: 'http://10.0.0.5/' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save changes' })));
    expect(screen.getAllByText(/private network/)).toHaveLength(2);
  });

  it('remove asks first, shows Undo, and the discard dialog lists what would be lost', async () => {
    renderEditor(true);
    expect(screen.getByText('Saved — takes effect on the next round')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Key page/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove this monitor' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Remove Key page · /booking?');
    expect(dialog).toHaveTextContent('Nok and Ploy will no longer get PROBLEM alerts from it');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove monitor' }));
    expect(screen.getByText('Removed on save')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const discard = await screen.findByRole('alertdialog');
    expect(discard).toHaveTextContent('Discard 1 change?');
    expect(discard).toHaveTextContent('You will lose: removing Key page · /booking.');
    fireEvent.click(within(discard).getByRole('button', { name: 'Keep editing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    // Back to clean, right after a save: the button says so.
    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled();
  });

  it('adds one new key page at a time, with headers, and refuses a reserved header name', () => {
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Add monitor' }));
    expect(screen.getByRole('button', { name: 'Add monitor · save first to add another' })).toBeDisabled();
    expect(screen.getAllByText('Key page · new').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Add header' }));
    fireEvent.change(screen.getByLabelText('Header name'), { target: { value: 'Cookie' } });
    expect(
      screen.getByText('Set by the monitor itself or a credential — not allowed here'),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove header Cookie' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Enabled' }));
    fireEvent.change(screen.getByLabelText('Slow when p50 is over'), { target: { value: '4000' } });
    fireEvent.change(screen.getByLabelText('Method'), { target: { value: 'HEAD' } });
    // A new monitor that isn't saved goes without asking.
    fireEvent.click(screen.getByRole('button', { name: 'Remove this monitor' }));
    expect(screen.getByRole('button', { name: 'Add monitor' })).toBeEnabled();
  });
});
