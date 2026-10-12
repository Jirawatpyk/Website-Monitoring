import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TimelineItem } from '../model';
import { TimelineLines } from './incident-sections';

const line = (time: string, title: string, kind: TimelineItem['kind'] = 'problem'): TimelineItem => ({
  at: `2026-09-25T${time}+07:00`,
  time,
  kind,
  title,
  detail: null,
});

const flap: TimelineItem = {
  ...line('13:06:00', 'Flapped ×3 between 13:06 and 13:21', 'flapping'),
  detail: 'PROBLEM again ×3 · each recovered · 6 events',
  run: [
    line('13:06:00', 'Problem again · flapping'),
    line('13:09:00', 'Recovered → Monitoring', 'recovered'),
    line('13:12:00', 'Problem again · flapping'),
    line('13:15:00', 'Recovered → Monitoring', 'recovered'),
    line('13:18:00', 'Problem again · flapping'),
    line('13:21:00', 'Recovered → Monitoring', 'recovered'),
  ],
};

describe('TimelineLines — a flapping run (D-038 follow-up)', () => {
  it('shows one line; "Show 6" opens its lines and "Hide" folds them again', async () => {
    render(
      <TimelineLines items={[line('13:00:00', 'First failed check', 'failed'), flap]} newestFirst={false} />,
    );
    expect(screen.getByText('Flapped ×3 between 13:06 and 13:21')).toBeInTheDocument();
    expect(screen.queryByText('Problem again · flapping')).not.toBeInTheDocument();

    const show = screen.getByRole('button', { name: 'Show 6' });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(show);
    expect(screen.getAllByText('Problem again · flapping')).toHaveLength(3);
    const hide = screen.getByRole('button', { name: 'Hide' });
    expect(hide).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(hide);
    expect(screen.queryByText('Problem again · flapping')).not.toBeInTheDocument();
  });

  it('a phone reads the run newest first too', async () => {
    render(<TimelineLines items={[flap]} newestFirst />);
    await userEvent.click(screen.getByRole('button', { name: 'Show 6' }));
    const inner = screen.getAllByRole('list')[1]!;
    expect(inner.querySelector('li')).toHaveTextContent('13:21:00');
  });
});
