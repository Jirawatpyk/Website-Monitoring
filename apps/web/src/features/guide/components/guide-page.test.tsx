import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { guideTopics, type GuideFacts } from '../content';
import { GuidePage } from './guide-page';

const nav = vi.hoisted(() => ({ topic: null as string | null, push: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/guide',
  useRouter: () => ({ push: nav.push }),
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
  nav.push.mockClear();
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
      'page',
    );
  });

  it('a search with no match shows the empty state, and Clear brings everything back', async () => {
    const user = userEvent.setup();
    renderGuide('Viewer');
    await user.type(screen.getAllByRole('textbox', { name: 'Search the guide' })[0]!, 'zzz');
    expect(within(desktopNav()).getByText('No topics match “zzz” for Viewer')).toBeInTheDocument();
    await user.click(within(desktopNav()).getByRole('button', { name: 'Clear search and filters' }));
    expect(within(desktopNav()).getByText('11 topics')).toBeInTheDocument();
  });

  it('on the phone a topic opens through ?topic=, and the open topic takes focus', async () => {
    const user = userEvent.setup();
    const { rerender } = renderGuide();
    const list = screen.getByRole('group', { name: 'Filter by role' }).parentElement!;
    await user.click(within(list).getByRole('button', { name: /Recover, root cause & resolve/ }));
    expect(nav.push).toHaveBeenCalledWith('/guide?topic=resolve');
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

  it('a Responder isn’t offered Admin-only screens', () => {
    nav.topic = 'mute';
    renderGuide();
    expect(screen.queryByRole('link', { name: /Audit log/ })).toBeNull();
  });
});
