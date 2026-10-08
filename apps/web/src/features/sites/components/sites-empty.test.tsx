import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SitesEmpty } from './sites-empty';

describe('SitesEmpty (Empty states panel 1, spec §20)', () => {
  it('an Admin gets "Add first site"; the Chat step reads its real state', () => {
    render(<SitesEmpty isAdmin chatConnected />);
    expect(screen.getByRole('heading', { name: 'Nothing is being monitored yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add first site' })).toHaveAttribute('href', '/sites/new');
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('everyone else reads who can add sites', () => {
    render(<SitesEmpty isAdmin={false} chatConnected={false} />);
    expect(screen.queryByRole('link', { name: 'Add first site' })).not.toBeInTheDocument();
    expect(screen.getByText('Only an Admin can add sites')).toBeInTheDocument();
    expect(screen.getByText('Not set up')).toBeInTheDocument();
  });
});
