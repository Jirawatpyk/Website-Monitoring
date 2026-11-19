import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsHeader } from './settings-header';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/settings/organisation' }));

beforeEach(() => router.push.mockReset());

/** The phone's field (jsdom renders both the tabs and the select; CSS picks one). */
const phone = (c: HTMLElement) => c.querySelector<HTMLElement>('.md\\:hidden')!;

describe('Settings pages on a phone (§35.1, S17)', () => {
  it('a choice opens that page', () => {
    const { container } = render(<SettingsHeader current="organisation" />);
    fireEvent.change(phone(container).querySelector('select')!, { target: { value: '/settings/users' } });
    expect(router.push).toHaveBeenCalledWith('/settings/users');
  });

  it('an arrow key on the closed field opens the list and goes nowhere (WCAG 3.2.2)', () => {
    const { container } = render(<SettingsHeader current="organisation" />);
    const field = within(phone(container)).getByRole('combobox', { name: 'Settings page' });
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(field).toHaveAttribute('aria-expanded', 'true');
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Users & roles',
      'Sign-in & security',
      'Organisation',
    ]);
  });

  it('the current page is never pushed again', () => {
    const { container } = render(<SettingsHeader current="organisation" />);
    fireEvent.change(phone(container).querySelector('select')!, {
      target: { value: '/settings/organisation' },
    });
    expect(router.push).not.toHaveBeenCalled();
  });
});
