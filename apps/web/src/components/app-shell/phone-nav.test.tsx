import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PhoneNav } from './phone-nav';

vi.mock('next/navigation', () => ({ usePathname: () => '/sites' }));

const overview = () => screen.getByRole('link', { name: /Overview/ });

describe('PhoneNav', () => {
  it('drops the focus a tap leaves on a tab, so the bar can slide away on the next page', () => {
    render(<PhoneNav />);
    overview().focus();
    expect(overview()).toHaveFocus();
    fireEvent.click(overview(), { detail: 1 });
    expect(overview()).not.toHaveFocus();
  });

  it('keeps keyboard focus on the tab (Enter clicks with detail 0)', () => {
    render(<PhoneNav />);
    overview().focus();
    fireEvent.click(overview(), { detail: 0 });
    expect(overview()).toHaveFocus();
  });
});
