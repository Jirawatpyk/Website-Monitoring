import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNow } from './use-now';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-25T03:07:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('useNow', () => {
  it('starts at the server time and moves every minute while ticking', () => {
    const { result } = renderHook(() => useNow('2026-09-25T03:07:00Z', 60_000));
    expect(result.current.toISOString()).toBe('2026-09-25T03:07:00.000Z');
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.toISOString()).toBe('2026-09-25T03:08:00.000Z');
  });

  it('stands still when not ticking, and follows a newer server time after a refresh', () => {
    const { result, rerender } = renderHook(({ iso }) => useNow(iso, 60_000, false), {
      initialProps: { iso: '2026-09-25T03:07:00Z' },
    });
    act(() => vi.advanceTimersByTime(120_000));
    expect(result.current.toISOString()).toBe('2026-09-25T03:07:00.000Z');
    rerender({ iso: '2026-09-25T03:10:00Z' });
    expect(result.current.toISOString()).toBe('2026-09-25T03:10:00.000Z');
  });
});
