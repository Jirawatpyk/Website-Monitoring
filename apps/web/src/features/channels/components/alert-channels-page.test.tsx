import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChannelsData } from '../queries';
import { AlertChannelsPageView } from './alert-channels-page';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/settings/alert-channels',
}));
vi.mock('../actions', () => ({ sendChannelTest: vi.fn() }));

const data = (lastTest: ChannelsData['lastTest']): ChannelsData => ({
  facts: {
    chatConnected: true,
    emailConnected: true,
    emailFrom: 'DxT Monitor <alerts@example.test>',
    lastChat: null,
    email24h: { sent: 0, failed: 0 },
  },
  ladders: { t1Down: [], t2Down: [], t3Down: [], problem: [] },
  admins: ['Tao'],
  reminders: { downMin: 15, problemMin: 60 },
  hours: { startMin: 540, endMin: 1080, days: [1, 2, 3, 4, 5] },
  log: [],
  canTestChat: true,
  lastTest,
});

describe('Alert channels test buttons', () => {
  it('a test sent inside the last minute keeps its button waiting after a reload (/verify)', () => {
    const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString();
    render(
      <AlertChannelsPageView
        data={data({ chat: tenSecondsAgo, email: null })}
        now={new Date().toISOString()}
      />,
    );
    expect(screen.getByRole('button', { name: /send test card/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /send test email/i })).toBeEnabled();
  });

  it('a test over a minute old leaves the button free', () => {
    const twoMinutesAgo = new Date(Date.now() - 120_000).toISOString();
    render(
      <AlertChannelsPageView
        data={data({ chat: twoMinutesAgo, email: twoMinutesAgo })}
        now={new Date().toISOString()}
      />,
    );
    expect(screen.getByRole('button', { name: /send test card/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /send test email/i })).toBeEnabled();
  });
});
