/** A Settings section's h2: the phone boards' mono caps (MUsers, MSecurity), the 24 px heading from md. */
export const SECTION_HEADING =
  'm-0 font-mono text-xs font-normal text-fg-tertiary md:font-sans md:text-2xl md:font-semibold md:text-fg-primary';

/**
 * A person's card on the phone lists (MUsers §35.3, MSecurity §35.6): hover, and a focus ring drawn inside
 * so the list's rounded, clipped frame doesn't cut it (MSecurity `.st-card:focus-visible`; the audit cards'
 * pattern).
 */
export const PERSON_CARD =
  'flex min-h-16 w-full items-center gap-2.5 border-0 border-b border-border-subtle bg-transparent py-2.5 pr-2 pl-3.5 text-left text-fg-primary last:border-b-0 hover:bg-bg-surface-hover active:bg-bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring';
