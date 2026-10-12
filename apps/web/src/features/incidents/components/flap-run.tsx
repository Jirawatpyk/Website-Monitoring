'use client';

import { useState } from 'react';
import { Button } from '@jirawatpyk/aura-react';

/**
 * A collapsed flapping run's lines (D-038 follow-up): drawn on the server, shown on demand so a
 * flapping incident's timeline stays readable; nothing is dropped (§16.11). It takes the timeline
 * line's full width: the button's label lines up with the line's text (time 16 + gap 3 + icon 4 +
 * gap 3, less the ghost button's own 3 of padding), and the run's lines open under it on the same
 * time / icon / text columns as the rest of the timeline.
 */
export function FlapRun({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex basis-full flex-col">
      <Button
        variant="ghost"
        size="sm"
        touchHeight
        className="ml-23 self-start"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Hide' : `Show ${count}`}
      </Button>
      {open && <div className="mt-1 border-t border-border-subtle">{children}</div>}
    </div>
  );
}
