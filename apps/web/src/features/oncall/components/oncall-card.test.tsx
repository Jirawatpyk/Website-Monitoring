import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OncallCard } from './oncall-card';

describe('OncallCard (Overview, Main3)', () => {
  it('lists who responds now, tonight and next week, and links to the rotation', () => {
    render(
      <OncallCard
        card={{
          lines: [
            { who: null, text: 'Site owners respond', when: 'until 18:00' },
            { who: 'Ploy', text: 'Ploy · Tier 1 on call', when: '18:00 → Mon 09:00' },
            { who: 'Nok', text: 'Nok · next week', when: 'from Mon 28 Sep' },
          ],
          foot: 'Tier 2–3: Mon–Fri 09:00–18:00 — outside those hours escalation waits until 09:00.',
        }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'On call' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Rotation →' })).toHaveAttribute('href', '/oncall');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Site owners responduntil 18:00',
      'PLPloy · Tier 1 on call18:00 → Mon 09:00',
      'NONok · next weekfrom Mon 28 Sep',
    ]);
    expect(screen.getByText(/escalation waits until 09:00/)).toBeInTheDocument();
  });
});
