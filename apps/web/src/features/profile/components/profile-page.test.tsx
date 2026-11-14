import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfileData } from '../model';
import { ProfilePageView } from './profile-page';

const settings = vi.hoisted(() => ({ signOutDevice: vi.fn(), setChatId: vi.fn() }));
const oncall = vi.hoisted(() => ({ sendTest: vi.fn() }));
const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/profile' }));
vi.mock('@/features/oncall', () => oncall);
// The settings feature's real dialog and device list (its public entry); only its Server Actions are stubbed.
vi.mock('@/features/settings/actions', () => ({ ...settings }));

// Fri 25 Sep 2026 10:08 Bangkok.
const NOW = '2026-09-25T03:08:00.000Z';
const ME = '00000000-0000-4000-8000-000000000002';
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

const data: ProfileData = {
  me: { id: ME, name: 'Arm', email: 'arm@x', role: 'responder', chatLinked: true },
  sessions: [
    { id: 's1', userId: ME, userAgent: MAC, createdAt: NOW, lastUsed: NOW, current: true },
    {
      id: 's2',
      userId: ME,
      userAgent: IPHONE,
      createdAt: NOW,
      lastUsed: '2026-09-24T09:40:00Z',
      current: false,
    },
  ],
  sites: [
    {
      id: 'a',
      name: 'realme.link',
      tier: 1,
      status: 'ok',
      role: 'Owner',
      incident: null,
      mutedUntil: null,
      internal: false,
    },
  ],
  isCeo: false,
  isAm: false,
  policies: [],
  inRotation: true,
  shifts: [{ startsAt: '2026-10-05T02:00:00Z', endsAt: '2026-10-12T02:00:00Z' }],
  swap: null,
  hours: { start: '09:00:00', end: '18:00:00', days: [1, 2, 3, 4, 5] },
  emailOn: true,
  admins: ['Tao'],
};

const signOutAction = vi.fn(async () => {});

beforeEach(() => {
  vi.clearAllMocks();
  settings.signOutDevice.mockResolvedValue({ ok: true, outcome: '1' });
  settings.setChatId.mockResolvedValue({ ok: true });
  oncall.sendTest.mockResolvedValue({ ok: true, at: NOW });
});

describe('ProfilePageView (Profile, MProfile)', () => {
  it('signs out another device; this browser has no button', async () => {
    const user = userEvent.setup();
    render(<ProfilePageView data={data} now={NOW} signOutAction={signOutAction} />);
    expect(screen.getByText('This device')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Sign out Safari · iPhone/ }));
    await waitFor(() => expect(settings.signOutDevice).toHaveBeenCalledWith({ sessionId: 's2' }));
    expect(await screen.findByText('Signed out · now')).toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalled();
  });

  it('the test alert says where it went, without timings (D-062 items 8, 12)', async () => {
    const user = userEvent.setup();
    render(<ProfilePageView data={data} now={NOW} signOutAction={signOutAction} />);
    await user.click(screen.getAllByRole('button', { name: 'Send me a test alert' })[0]!);
    expect(await screen.findByText('Test sent at 10:08')).toBeInTheDocument();
    // The SQL refuses another within a minute: the button says it went and waits (spec-checker).
    for (const b of screen.getAllByRole('button', { name: 'Test alert sent · 10:08' }))
      expect(b).toBeDisabled();
    expect(screen.queryByText(/1\.3 s|2\.2 s/)).toBeNull();
  });

  it('no Chat id: the test waits for one, and says why', () => {
    render(
      <ProfilePageView
        data={{ ...data, me: { ...data.me, chatLinked: false } }}
        now={NOW}
        signOutAction={signOutAction}
      />,
    );
    for (const b of screen.getAllByRole('button', { name: 'Send me a test alert' })) expect(b).toBeDisabled();
    expect(
      screen.getAllByText('Add your Chat id first — the test is a Chat @mention.').length,
    ).toBeGreaterThan(0);
  });

  it('a Viewer: no test button, no on-call card', () => {
    render(
      <ProfilePageView
        data={{ ...data, me: { ...data.me, role: 'viewer' }, shifts: [], inRotation: false, sites: [] }}
        now={NOW}
        signOutAction={signOutAction}
      />,
    );
    expect(screen.queryByRole('button', { name: /test alert/i })).toBeNull();
    expect(screen.queryByText('MY NEXT ON-CALL SHIFT')).toBeNull();
    // §22.6: a Viewer sees channels, devices and the shared values only.
    expect(screen.queryByRole('heading', { name: /Sites I’m responsible for/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Where I sit in escalation' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Signed-in devices' })).toBeInTheDocument();
  });

  it('your own Chat id: the dialog says "you", and focus comes back to Edit Chat id…', async () => {
    const user = userEvent.setup();
    render(<ProfilePageView data={data} now={NOW} signOutAction={signOutAction} />);
    await user.click(screen.getByRole('button', { name: 'Edit Chat id…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Your Google Chat id' });
    await user.type(within(dialog).getByLabelText(/Chat user id/), '123456');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(settings.setChatId).toHaveBeenCalledWith({ userId: ME, chatId: '123456' }));
    expect(await screen.findByText('Your Chat id saved · logged')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Chat id…' })).toHaveFocus());
  });
});
