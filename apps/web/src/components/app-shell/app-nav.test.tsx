import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '@jirawatpyk/aura-react';
import { AppNav } from './app-nav';

vi.mock('next/navigation', () => ({ usePathname: () => '/sites' }));

describe('AppNav in the phone drawer', () => {
  it('closes the drawer when an item is chosen, the current page included (Tao, 8 Oct 2026)', async () => {
    const user = userEvent.setup();
    render(
      <AppShell nav={<AppNav header={<span>Brand</span>} footer={<span>Footer</span>} />}>
        <p>Page</p>
      </AppShell>,
    );
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    const drawer = await screen.findByRole('dialog');
    const link = within(drawer).getByRole('link', { name: 'Sites' });
    // jsdom can't navigate: stop the link after React has handled the click, so the drawer closes on the choice alone
    const stop = (e: Event) => e.preventDefault();
    window.addEventListener('click', stop);
    await user.click(link);
    window.removeEventListener('click', stop);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
