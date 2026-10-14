import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MobileBar } from './mobile-bar';
import { PhoneBar } from './phone-bar';

describe('PhoneBar in MobileBar (spec §22.1, D-045)', () => {
  it('Overview: the brand and the avatar, no back arrow', () => {
    render(
      <MobileBar displayName="Arm">
        <PhoneBar title={null} />
      </MobileBar>,
    );
    expect(screen.getByText('DxT')).toBeInTheDocument();
    expect(screen.getByLabelText('Arm')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('a detail page: back arrow, the title (not a second h1), its own buttons, then the avatar', () => {
    render(
      <MobileBar displayName="Arm">
        <PhoneBar
          title="Bangkok Airways – Taiwan"
          back={{ href: '/sites', label: 'Back to sites' }}
          actions={<button type="button">More actions</button>}
        />
      </MobileBar>,
    );
    expect(screen.getByRole('link', { name: 'Back to sites' })).toHaveAttribute('href', '/sites');
    expect(screen.getByText('Bangkok Airways – Taiwan').tagName).toBe('P');
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByText('DxT')).not.toBeInTheDocument();
    const order = [
      screen.getByRole('link'),
      screen.getByText('Bangkok Airways – Taiwan'),
      screen.getByRole('button'),
      screen.getByLabelText('Arm'),
    ];
    for (let i = 1; i < order.length; i++)
      expect(
        order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
  });
});
