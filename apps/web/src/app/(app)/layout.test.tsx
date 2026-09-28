import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AppLayout from './layout';

describe('AppLayout', () => {
  it('renders the brand, the live nav items and the page', () => {
    render(
      <AppLayout>
        <p>page content</p>
      </AppLayout>,
    );

    expect(screen.getAllByText('DxT').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Monitor').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Overview' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: 'Incidents' })).toBeNull(); // not live until S07
    expect(screen.getByText('page content')).toBeInTheDocument();
  });
});
