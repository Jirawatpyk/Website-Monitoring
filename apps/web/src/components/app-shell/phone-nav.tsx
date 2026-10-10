'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { BottomNav } from '@jirawatpyk/aura-react';
import { activeNavId, bottomNavWithCounts, type NavCounts } from './nav';

/** Scroll this far in one direction before the bar moves, so a finger's jitter doesn't flicker it. */
const SCROLL_STEP = 8;

/**
 * The phone boards' BottomNav (D-018, D-031): the main sections below lg — phones and tablets — beside
 * the menu drawer, which still reaches every other page. Only live sections are listed (D-032). It slides
 * away while scrolling down and comes back on the way up, at the top, or when a keyboard reaches it (Tao,
 * S06b); AURA request 14 asks for this in BottomNav itself. While it is away the page gets its space back:
 * `--aura-bottomnav-offset` (what sticky bars and toasts sit on) drops to the safe area (`globals.css`).
 * A page with its own bottom action bar (`data-hides-bottomnav`, the incident page) keeps it away for good,
 * in CSS, so the server's HTML is already right.
 */
export function PhoneNav({ counts = {} }: { counts?: NavCounts }) {
  const pathname = usePathname();
  const value = activeNavId(pathname) ?? undefined;
  // the page the bar slid away on: a new page starts with it in view, no reset needed
  const [awayOn, setAwayOn] = useState<string | null>(null);
  const scrolledAway = awayOn === pathname;
  const last = useRef(0);

  useEffect(() => {
    last.current = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const delta = y - last.current;
        if (y <= 0) setAwayOn(null);
        else if (Math.abs(delta) >= SCROLL_STEP) setAwayOn(delta > 0 ? window.location.pathname : null);
        if (Math.abs(delta) >= SCROLL_STEP || y <= 0) last.current = y;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    document.documentElement.toggleAttribute('data-bottomnav-hidden', scrolledAway);
    return () => document.documentElement.removeAttribute('data-bottomnav-hidden');
  }, [scrolledAway]);

  return (
    <div className="contents" onFocus={() => setAwayOn(null)}>
      <BottomNav
        items={bottomNavWithCounts(counts)}
        value={value}
        label="Sections"
        hideFrom="lg"
        className={`transition-transform duration-200 motion-reduce:transition-none ${scrolledAway ? 'translate-y-full' : ''}`}
      />
    </div>
  );
}
