/**
 * A line that takes focus after its button went away (an outcome, a "Resolved" heading; WCAG 2.4.3).
 * The ring sits inside a little padding — pulled back by a negative margin so the text stays aligned —
 * so it neither hugs the letters nor gets clipped by a dialog's edge (S07 /verify).
 */
export const FOCUS_TARGET =
  '-mx-1.5 rounded-aura-sm px-1.5 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-strong';
