import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './page-header';

describe('PageHeader', () => {
  it('renders eyebrow, one h1 and the optional meta line and actions', () => {
    render(
      <PageHeader
        eyebrow="OVERVIEW"
        title="Overview"
        meta="Fri 25 Sep · live"
        actions={<button>Add</button>}
      />,
    );
    expect(screen.getByText('OVERVIEW')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByText('Fri 25 Sep · live')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('adds no padding of its own (AppShell pads the page)', () => {
    const { container } = render(<PageHeader eyebrow="SITES" title="Sites" />);
    expect((container.firstElementChild as HTMLElement).className).not.toMatch(/\b(p|py|pt)-/);
  });
});
