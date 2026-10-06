import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppLayout from './layout';

const mocks = vi.hoisted(() => ({
  getAccess: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));
vi.mock('@/lib/auth/session', () => ({ getAccess: mocks.getAccess }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/features/auth/actions', () => ({ signOut: vi.fn() }));

const page = <p>page content</p>;

beforeEach(() => vi.clearAllMocks());

describe('AppLayout', () => {
  it('renders the brand, the live nav items, the account footer and the page', async () => {
    mocks.getAccess.mockResolvedValue({
      status: 'active',
      profile: { id: 'u1', email: 'arm@example.test', displayName: 'Arm', role: 'responder' },
    });
    render(await AppLayout({ children: page }));

    expect(screen.getAllByText('DxT').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Overview' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: 'Incidents' })).toBeNull(); // not live until S07
    expect(screen.getAllByText('Arm').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Responder').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Sign out' })[0]).toHaveAttribute('title', 'Sign out');
    expect(screen.getByText('page content')).toBeInTheDocument();
  });

  it.each([
    ['inactive', '/auth/refused'],
    ['missing', '/auth/refused'],
    ['signed-out', '/login'],
  ])('sends a %s session to %s', async (status, target) => {
    mocks.getAccess.mockResolvedValue({ status, email: null });
    await expect(AppLayout({ children: page })).rejects.toThrow(`redirect:${target}`);
  });
});
