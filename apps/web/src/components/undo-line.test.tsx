import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UndoLine } from './undo-line';

const NOW = new Date('2026-11-21T08:43:00.000Z');

describe('UndoLine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const postsAt = new Date(NOW.getTime() + 2000).toISOString();

  it('counts down, then says it posted', () => {
    render(<UndoLine postsAt={postsAt} onUndo={() => {}} channels="Chat" />);
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.getByRole('button', { name: /Undo · \d s/ })).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByText('Posted to Chat.')).toBeInTheDocument();
  });

  it('an Undo still on its way when the count ends never reads as posted (S19 UAT F1)', async () => {
    let answer: () => void = () => {};
    const onUndo = vi.fn(() => new Promise<void>((resolve) => (answer = resolve)));
    render(<UndoLine postsAt={postsAt} onUndo={onUndo} channels="Chat" />);
    act(() => void vi.advanceTimersByTime(1000));
    fireEvent.click(screen.getByRole('button', { name: /Undo/ }));
    expect(onUndo).toHaveBeenCalledOnce();

    // The window closes while the server hasn't answered yet.
    act(() => void vi.advanceTimersByTime(3000));
    expect(screen.queryByText('Posted to Chat.')).not.toBeInTheDocument();
    expect(screen.getByText('Undoing…')).toBeInTheDocument();

    // The caller replaces the toast with the server's answer; a refusal falls back to the posted line.
    await act(async () => answer());
    expect(screen.getByText('Posted to Chat.')).toBeInTheDocument();
  });
});
