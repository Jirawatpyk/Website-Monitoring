import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BarLoading from './loading';

const nav = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));

describe('@bar loading', () => {
  beforeEach(() => {
    nav.pathname = '/';
  });

  // An empty bar blanked the title for ~0.3 s on a tab switch (Sites → Incidents, 15 Oct).
  it('shows the title of the page being opened, not an empty bar', () => {
    nav.pathname = '/incidents';
    render(<BarLoading />);
    expect(screen.getByText('Incidents')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Back to/ })).not.toBeInTheDocument();
  });

  it('keeps the back arrow on a page off the tabs', () => {
    nav.pathname = '/maintenance';
    render(<BarLoading />);
    expect(screen.getByText('Maintenance')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to overview' })).toHaveAttribute('href', '/');
  });

  it('shows the brand while Overview opens', () => {
    render(<BarLoading />);
    expect(screen.getByText('Monitor')).toBeInTheDocument();
  });
});
