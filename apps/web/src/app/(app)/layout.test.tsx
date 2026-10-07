import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppLayout from './layout';

const mocks = vi.hoisted(() => ({
  getAccess: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));
vi.mock('@/lib/auth/session', () => ({ getAccess: mocks.getAccess }));
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/',
}));
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
    // AURA 5.32: the name shows in AURA's own tip (hover + keyboard focus), not a native title.
    expect(screen.getAllByRole('button', { name: 'Sign out' })[0]).toHaveAttribute('data-aura-tip');
    expect(screen.getByText('page content')).toBeInTheDocument();
  });

  it('puts the brand and the avatar in the phone top bar', async () => {
    mocks.getAccess.mockResolvedValue({
      status: 'active',
      profile: { id: 'u1', email: 'arm@example.test', displayName: 'Arm', role: 'responder' },
    });
    const { container } = render(await AppLayout({ children: page }));

    const bar = container.querySelector('.aura-shell__bar');
    expect(bar).not.toBeNull();
    expect(within(bar as HTMLElement).getByText('DxT')).toBeInTheDocument();
    expect(within(bar as HTMLElement).getByLabelText('Arm')).toBeInTheDocument();
    // AURA hides it from lg, like a menu-only bar (`headerHideFrom="lg"`).
    expect(bar).toHaveClass('aura-shell__bar--menu-only');
    expect(container.querySelector('.aura-shell')).toHaveClass('aura-shell--menu-bar');
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
