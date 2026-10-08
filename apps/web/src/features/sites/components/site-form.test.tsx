import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RegistrationOptions, SiteRecord } from '../types';
import { SiteForm } from './site-form';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh, replace: vi.fn() }) }));
const actions = vi.hoisted(() => ({
  createSite: vi.fn(),
  updateSite: vi.fn(),
  setSiteMonitoring: vi.fn(),
  deleteSite: vi.fn(),
}));
vi.mock('../actions', () => actions);

const NOK = '00000000-0000-4000-8000-000000000001';
const PLOY = '00000000-0000-4000-8000-000000000002';
const ARM = '00000000-0000-4000-8000-000000000003';
const INTERNAL = '00000000-0000-4000-8000-0000000000c1';

const options: RegistrationOptions = {
  clients: [{ id: INTERNAL, name: 'Internal', internal: true, amName: null }],
  people: [
    { id: NOK, name: 'Nok', linked: true },
    { id: PLOY, name: 'Ploy', linked: true },
    { id: ARM, name: 'Arm', linked: false },
  ],
  existingUrls: [{ url: 'https://taken.example.com/', siteId: 'other', siteName: 'Taken' }],
};

const site: SiteRecord = {
  id: '00000000-0000-4000-8000-0000000000a1',
  name: 'EQHO Academy',
  tier: 2,
  clientId: INTERNAL,
  primaryOwnerId: ARM,
  backupOwnerId: PLOY,
  ownerName: 'Arm',
  backupName: 'Ploy',
  hosting: 'Example hosting',
  credentialRef: 'Team vault › EQHO',
  behindWaf: false,
  wafAllowlistConfirmed: false,
  live: false,
  everStarted: false,
  monitors: [
    {
      id: 'm1',
      isPrimary: true,
      url: 'https://eqho.example.com/',
      method: 'GET',
      timeoutSec: 30,
      mustContain: ['EQHO Academy'],
      mustNotContain: [],
      allowedRedirectDomains: [],
      slowMs: null,
      headers: [],
      enabled: true,
    },
  ],
};

const renderForm = (s?: SiteRecord) =>
  render(<SiteForm options={options} site={s} bkkIp={null} secretHeaderName="X-DxT-Monitor" />);

afterEach(() => vi.clearAllMocks());

describe('SiteForm (AddSite)', () => {
  it('starts with the checklist open and Start monitoring disabled with what is left', () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'Start monitoring' })).toBeDisabled();
    expect(
      screen.getByText(
        '6 items left: URL, Brand keyword, Primary owner, Backup owner, Client, Credential reference',
      ),
    ).toBeInTheDocument();
    // Must not contain starts with the PRD's defaults; no shared spam list tag (D-025).
    expect(screen.getByLabelText('Must not contain')).toHaveValue('Index of /, Database error');
    expect(screen.queryByText(/gambling/i)).not.toBeInTheDocument();
  });

  // D-015: an owner without a Chat id can't be picked, and is named.
  it('lists people without a Google Chat id as disabled', () => {
    renderForm();
    // AURA Select keeps a native <select> under its own list: the options live there.
    const arm = [...document.querySelectorAll('option')].find((o) => o.textContent === 'Arm · no Chat id');
    expect(arm).toBeDefined();
    expect(arm!.disabled).toBe(true);
    expect(screen.getByText('Owners need a Google Chat id before they can be assigned.')).toBeInTheDocument();
  });

  it('flags a URL another site already monitors', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/Primary URL/), {
      target: { value: 'https://TAKEN.example.com' },
    });
    expect(
      screen.getAllByText('Already monitored as another site — open that site instead of adding a duplicate.')
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('This URL is already monitored')).toBeInTheDocument();
  });

  it('shows the server’s refusal, naming who needs a Chat id (D-015)', async () => {
    actions.createSite.mockResolvedValue({
      ok: false,
      message: 'Arm needs a Google Chat id before they can own a site — ask an Admin to add it.',
    });
    renderForm();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save draft' })));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Arm needs a Google Chat id before they can own a site — ask an Admin to add it.',
    );
    expect(push).not.toHaveBeenCalled();
  });

  it('Save draft opens the new site’s edit page', async () => {
    actions.createSite.mockResolvedValue({ ok: true, siteId: 'new-id' });
    renderForm();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save draft' })));
    expect(actions.createSite).toHaveBeenCalledWith(expect.objectContaining({ start: false }));
    expect(push).toHaveBeenCalledWith('/sites/new-id/edit?draft=1');
  });
});

describe('SiteForm (Edit site)', () => {
  it('names an owner who has no Chat id and keeps Start disabled (D-015)', () => {
    renderForm(site);
    expect(screen.getByText('Arm has no Google Chat id — ask an Admin to add it')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start monitoring' })).toBeDisabled();
    expect(screen.getByText('1 item left: Primary owner')).toBeInTheDocument();
  });

  it('a never-started Draft can be deleted after a confirm', async () => {
    actions.deleteSite.mockResolvedValue({ ok: true, siteId: site.id });
    renderForm({ ...site, primaryOwnerId: NOK });
    fireEvent.click(screen.getByRole('button', { name: 'Delete site' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Delete EQHO Academy?');
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Delete site' })));
    expect(actions.deleteSite).toHaveBeenCalledWith(site.id);
    expect(push).toHaveBeenCalledWith('/sites');
  });

  it('a live site: Stop monitoring asks first; Delete is disabled with the reason', async () => {
    actions.setSiteMonitoring.mockResolvedValue({ ok: true, siteId: site.id });
    renderForm({ ...site, primaryOwnerId: NOK, live: true, everStarted: true });
    expect(screen.getByRole('button', { name: 'Delete site' })).toBeDisabled();
    expect(screen.getByText('Has monitoring history — stop monitoring instead')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop monitoring' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Stop monitoring EQHO Academy?');
    expect(dialog).toHaveTextContent('Owner and backup: Nok and Ploy');
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Stop monitoring' })));
    expect(actions.setSiteMonitoring).toHaveBeenCalledWith(site.id, false);
  });
});
