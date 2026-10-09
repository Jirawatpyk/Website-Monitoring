import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COALESCE_MS, LIVE_TABLES, useLiveRefresh } from './use-live-refresh';

type Handler = () => void;

const mocks = vi.hoisted(() => {
  const state = {
    handlers: [] as { event: string; table: string; fn: () => void }[],
    status: null as ((s: string) => void) | null,
    removed: 0,
  };
  const channel = {
    on: vi.fn((_type: string, filter: { event: string; table: string }, fn: () => void) => {
      state.handlers.push({ event: filter.event, table: filter.table, fn });
      return channel;
    }),
    subscribe: vi.fn((cb: (s: string) => void) => {
      state.status = cb;
      return channel;
    }),
  };
  return {
    state,
    channel,
    refresh: vi.fn(),
    client: {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => {
        state.removed += 1;
      }),
    },
  };
});

// Next's router is one stable object per page; a new one per render would re-subscribe
const router = { refresh: (...a: unknown[]) => mocks.refresh(...a) };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => mocks.client }));

beforeEach(() => {
  vi.useFakeTimers();
  mocks.state.handlers = [];
  mocks.state.status = null;
  mocks.state.removed = 0;
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

const fire = () => mocks.state.handlers[0]!.fn as Handler;

describe('useLiveRefresh (PRD §9, D-032)', () => {
  it('follows INSERT and UPDATE on site_status and incidents only — never DELETE', () => {
    renderHook(() => useLiveRefresh());
    expect(mocks.state.handlers.map((h) => `${h.table}:${h.event}`).sort()).toEqual(
      LIVE_TABLES.flatMap((t) => [`${t}:INSERT`, `${t}:UPDATE`]).sort(),
    );
  });

  it('is live once subscribed, and not after the channel closes', () => {
    const { result } = renderHook(() => useLiveRefresh());
    expect(result.current).toBe(false);
    act(() => mocks.state.status!('SUBSCRIBED'));
    expect(result.current).toBe(true);
    act(() => mocks.state.status!('CLOSED'));
    expect(result.current).toBe(false);
  });

  it('turns a burst of changes (a round touching every site) into one refresh', () => {
    renderHook(() => useLiveRefresh());
    act(() => {
      for (let n = 0; n < 17; n += 1) fire()();
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(COALESCE_MS));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    act(() => fire()());
    act(() => vi.advanceTimersByTime(COALESCE_MS));
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it('catches up after a reconnect, not on the first join', () => {
    renderHook(() => useLiveRefresh());
    act(() => mocks.state.status!('SUBSCRIBED'));
    act(() => vi.advanceTimersByTime(COALESCE_MS));
    expect(mocks.refresh).not.toHaveBeenCalled();
    act(() => mocks.state.status!('CHANNEL_ERROR'));
    act(() => mocks.state.status!('SUBSCRIBED'));
    act(() => vi.advanceTimersByTime(COALESCE_MS));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('removes its channel and pending refresh when the page goes', () => {
    const { unmount } = renderHook(() => useLiveRefresh());
    act(() => fire()());
    unmount();
    act(() => vi.advanceTimersByTime(COALESCE_MS));
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.client.removeChannel).toHaveBeenCalledWith(mocks.channel);
  });
});
