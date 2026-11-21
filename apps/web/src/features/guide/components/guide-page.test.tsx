import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { guideTopics, type GuideFacts } from '../content';
import { GuidePage, guideBackToList } from './guide-page';

const nav = vi.hoisted(() => ({ topic: null as string | null }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/guide',
  useSearchParams: () => new URLSearchParams(nav.topic ? { topic: nav.topic } : {}),
}));

const step = (level: number, delayMin: number) => ({
  level,
  delayMin,
  targets: level ? (['backup', 'admins'] as const).slice() : (['owner'] as const).slice(),
  channels: (['chat', 'email'] as const).slice(),
});
const FACTS: GuideFacts = {
  hours: 'Mon–Fri 09:00–18:00',
  tier1Sites: 3,
  admins: ['Pat', 'Sam'],
  onCallNow: null,
  onCallNext: [],
  policies: { t1: [step(0, 0), step(1, 15)], t2: [step(0, 0)], t3: [step(0, 0)], problem: [step(0, 0)] },
  downReminderMin: 15,
  problemReminderMin: 60,
  isAdmin: false,
};

const renderGuide = (mine: 'Responder' | 'Viewer' = 'Responder') =>
  render(
    <GuidePage desktop={guideTopics(FACTS, 'desktop')} phone={guideTopics(FACTS, 'phone')} mine={mine} />,
  );

const desktopNav = () => screen.getByRole('navigation', { name: 'Guide topics' });

beforeEach(() => {
  nav.topic = null;
  vi.restoreAllMocks();
});

describe('GuidePage (Guide, MGuide)', () => {
  it('opens on the viewer’s own chip, with “When an alert arrives” open', () => {
    renderGuide();
    expect(screen.getAllByText('Responder', { selector: 'span.font-medium' })[0]).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'When an alert arrives' })).toBeInTheDocument();
    expect(within(desktopNav()).getByText('8 of 11 topics · Responder')).toBeInTheDocument();
  });

  it('Show all widens the list; a pick moves focus to the article', async () => {
    const user = userEvent.setup();
    renderGuide();
    await user.click(screen.getAllByRole('button', { name: 'Show all' })[0]!);
    expect(within(desktopNav()).getByText('11 topics')).toBeInTheDocument();
    await user.click(within(desktopNav()).getByRole('button', { name: /Mute vs maintenance/ }));
    const heading = screen.getByRole('heading', { level: 2, name: 'Mute vs maintenance' });
    expect(heading).toHaveFocus();
    expect(within(desktopNav()).getByRole('button', { name: /Mute vs maintenance/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('a search with no match shows the empty state, and Clear brings everything back', async () => {
    const user = userEvent.setup();
    renderGuide('Viewer');
    await user.type(screen.getAllByRole('textbox', { name: 'Search the guide' })[0]!, 'zzz');
    expect(within(desktopNav()).getByText('No topics match “zzz” for Viewer')).toBeInTheDocument();
    await user.click(within(desktopNav()).getByRole('button', { name: 'Clear search and filters' }));
    expect(within(desktopNav()).getByText('11 topics')).toBeInTheDocument();
    // The button left with the empty state; focus is back in the search, not on the page.
    expect(screen.getAllByRole('textbox', { name: 'Search the guide' })[0]).toHaveFocus();
  });

  it('on the phone a topic opens through ?topic= without a navigation, and takes focus', async () => {
    const user = userEvent.setup();
    const push = vi.spyOn(window.history, 'pushState');
    const { rerender } = renderGuide();
    const list = screen.getByRole('group', { name: 'Filter by role' }).parentElement!;
    await user.click(within(list).getByRole('button', { name: /Recover, root cause & resolve/ }));
    expect(push).toHaveBeenCalledWith({ guide: true }, '', '/guide?topic=resolve');
    nav.topic = 'resolve';
    rerender(
      <GuidePage
        desktop={guideTopics(FACTS, 'desktop')}
        phone={guideTopics(FACTS, 'phone')}
        mine="Responder"
      />,
    );
    const headings = screen.getAllByRole('heading', { level: 2, name: 'Recover, root cause & resolve' });
    expect(headings.some((h) => h === document.activeElement)).toBe(true);
  });

  it('typing in search after a pick keeps focus in the field (code review)', async () => {
    const user = userEvent.setup();
    renderGuide();
    await user.click(within(desktopNav()).getByRole('button', { name: /Mute vs maintenance/ }));
    const field = screen.getAllByRole('textbox', { name: 'Search the guide' })[0]!;
    await user.click(field);
    await user.type(field, 'root cause');
    expect(field).toHaveFocus();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Recover, root cause & resolve' }),
    ).toBeInTheDocument();
  });

  it('back from a phone topic puts focus on its row', async () => {
    const user = userEvent.setup();
    vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
    const view = () => (
      <GuidePage
        desktop={guideTopics(FACTS, 'desktop')}
        phone={guideTopics(FACTS, 'phone')}
        mine="Responder"
      />
    );
    const { rerender, container } = render(view());
    const list = screen.getByRole('group', { name: 'Filter by role' }).parentElement!;
    await user.click(within(list).getByRole('button', { name: /Client updates/ }));
    nav.topic = 'client';
    rerender(view());
    nav.topic = null;
    rerender(view());
    expect(container.querySelector('[data-topic="client"]')).toHaveFocus();
  });

  it('a Related topic replaces the open one; Back focuses the row the list opened', async () => {
    const user = userEvent.setup();
    // Next tags its own history entries with `__NA` and doesn't sync useSearchParams for a state that
    // carries it, so the replace must pass a fresh object (/verify on staging, S18).
    const push = vi.spyOn(window.history, 'pushState').mockImplementation(() => {
      window.history.replaceState({ guide: true, __NA: true }, '');
    });
    const view = () => (
      <GuidePage desktop={guideTopics(FACTS, 'desktop')} phone={guideTopics(FACTS, 'phone')} mine="Viewer" />
    );
    const { rerender } = render(view());
    const list = screen.getByRole('group', { name: 'Filter by role' }).parentElement!;
    await user.click(within(list).getByRole('button', { name: /Statuses & badges/ }));
    expect(push).toHaveBeenCalledTimes(1);
    nav.topic = 'statuses';
    rerender(view());
    const replace = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
    // Statuses → Related "When an alert arrives", which the Viewer chip hides in the list.
    await user.click(within(list).getByRole('button', { name: /When an alert arrives/ }));
    expect(replace).toHaveBeenLastCalledWith({ guide: true }, '', '/guide?topic=alert');
    nav.topic = 'alert';
    rerender(view());
    nav.topic = null;
    rerender(view());
    // Back lands on the row the list opened (Statuses), not the hidden Related topic.
    expect(list.querySelector('[data-topic="statuses"]')).toHaveFocus();
  });

  it('back from a topic opened by a link replaces the entry with a state Next will sync', () => {
    window.history.replaceState({ __NA: true }, '', '/guide?topic=mute');
    const replace = vi.spyOn(window.history, 'replaceState');
    const back = vi.spyOn(window.history, 'back');
    guideBackToList('/guide');
    expect(back).not.toHaveBeenCalled();
    expect(replace).toHaveBeenLastCalledWith({ guide: false }, '', '/guide');
  });

  it('a Responder isn’t offered Admin-only screens', () => {
    nav.topic = 'mute';
    renderGuide();
    expect(screen.queryByRole('link', { name: /Audit log/ })).toBeNull();
  });
});
