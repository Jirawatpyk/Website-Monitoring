import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoadingList, NoAccess, OfflineStrip, OFFLINE_RETRY_MS, STILL_LOADING_AFTER_MS } from '.';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
}

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
  setOnline(true);
});
afterEach(() => vi.useRealTimers());

describe('LoadingList', () => {
  it('shows the shape and what is loading, never a status', () => {
    render(<LoadingList label="Loading 17 sites" rows={3} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading 17 sites');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('after 10 s says it is still loading, how old the data is, and offers Retry', () => {
    const onRetry = vi.fn();
    render(
      <LoadingList
        label="Loading 17 sites"
        lastDataAt={new Date('2026-09-25T03:06:00Z')}
        onRetry={onRetry}
      />,
    );
    act(() => vi.advanceTimersByTime(STILL_LOADING_AFTER_MS));
    expect(screen.getByRole('status')).toHaveTextContent('Still loading — last data 10:06');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('retries by refreshing the route by default', () => {
    render(<LoadingList label="Loading" />);
    act(() => vi.advanceTimersByTime(STILL_LOADING_AFTER_MS));
    expect(screen.getByRole('status')).toHaveTextContent(/^Still loading/);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe('OfflineStrip', () => {
  it('stays hidden while online', () => {
    render(<OfflineStrip />);
    expect(screen.queryByText(/Offline/)).toBeNull();
  });

  it('says what time the data is from, retries every 10 s, and refreshes when back online', () => {
    vi.setSystemTime(new Date('2026-09-25T03:06:00Z'));
    render(<OfflineStrip />);
    setOnline(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Offline — showing what you had at 10:06. Retrying every 10 s.',
    );

    act(() => vi.advanceTimersByTime(OFFLINE_RETRY_MS));
    expect(screen.getByRole('status')).toHaveTextContent('Retrying now…');
    expect(refresh).not.toHaveBeenCalled(); // still offline

    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByText(/Offline/)).toBeNull();
    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe('NoAccess', () => {
  it('explains the limit and names who can act — never a bare 403', () => {
    render(
      <NoAccess
        title="You can see this, not acknowledge it"
        description="You're signed in as a Viewer."
        people={[
          { name: 'Owner A', duty: 'owner', status: 'Not acked', urgent: true },
          { name: 'Backup B', duty: 'backup (L1)', status: 'Notified 10:03' },
        ]}
      />,
    );
    expect(screen.getByText('You can see this, not acknowledge it')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Who can act now' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Not acked')).toHaveClass('text-fg-danger');
  });

  it('can stand alone without a list', () => {
    render(<NoAccess title="Admins only" description="Ask an Admin to change this." />);
    expect(screen.queryByRole('heading', { name: 'Who can act now' })).toBeNull();
  });
});
