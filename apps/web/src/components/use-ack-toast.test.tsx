import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Toaster } from '@jirawatpyk/aura-react';
import { useAckToast, type AckAction, type UndoAction } from './use-ack-toast';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const ack: AckAction = async () => ({ ok: true, postsAt: new Date(Date.now() + 10_000).toISOString() });
const undo: UndoAction = async () => ({ ok: true });

function Probe({ severity }: { severity?: 'down' | 'problem' }) {
  const { acknowledge } = useAckToast({ ack, undo });
  return (
    <button type="button" onClick={() => acknowledge('i1', 142, severity)}>
      Acknowledge
    </button>
  );
}

describe('useAckToast — the toast says what the ack stopped (D-034)', () => {
  it.each([
    ['DOWN: escalation', 'down' as const, 'Acknowledged INC-0142 · escalation stopped'],
    ['PROBLEM: reminders', 'problem' as const, 'Acknowledged INC-0142 · reminders stopped'],
    ['unknown: nothing promised', undefined, 'Acknowledged INC-0142'],
  ])('%s', async (_case, severity, title) => {
    render(
      <>
        <Probe severity={severity} />
        <Toaster />
      </>,
    );
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' })));
    expect(await screen.findByText(title)).toBeInTheDocument();
  });
});

describe('useAckToast — an Undo still in flight when the 10 s end (S19 UAT F1)', () => {
  it('never says "Posted" while the Undo waits for the server', async () => {
    let answer: (v: { ok: true }) => void = () => {};
    const slowUndo: UndoAction = () => new Promise((resolve) => (answer = resolve));
    const shortAck: AckAction = async () => ({
      ok: true,
      postsAt: new Date(Date.now() + 1500).toISOString(),
    });
    function SlowProbe() {
      const { acknowledge } = useAckToast({ ack: shortAck, undo: slowUndo });
      return (
        <button type="button" onClick={() => acknowledge('i1', 142, 'down')}>
          Acknowledge
        </button>
      );
    }
    render(
      <>
        <SlowProbe />
        <Toaster />
      </>,
    );
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' })));
    const undoButton = await screen.findByRole('button', { name: /Undo/ });
    await act(async () => fireEvent.click(undoButton));
    // The window ends while the request is still out.
    await act(async () => new Promise((r) => setTimeout(r, 2200)));
    expect(screen.queryByText('Posted to Chat and email.')).not.toBeInTheDocument();
    expect(screen.getByText('Undoing…')).toBeInTheDocument();
    await act(async () => answer({ ok: true }));
    expect(await screen.findByText('Acknowledgement of INC-0142 undone')).toBeInTheDocument();
  });
});
