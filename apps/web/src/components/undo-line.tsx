import { useState } from 'react';
import { Button } from '@jirawatpyk/aura-react';
import { IconRotateCcw } from '@jirawatpyk/aura-react/icons';
import { useSecondsLeft } from '@/components/use-seconds-left';

/**
 * A held action's toast body: the hold line and "Undo · N s" while the 10 s window is open (spec
 * §16.8 for Acknowledge / Resolve, §24.8 for maintenance actions), then "Posted to Chat and email."
 */
export function UndoLine({
  postsAt,
  onUndo,
  channels = 'Chat and email',
}: {
  postsAt: string;
  onUndo: () => void | Promise<void>;
  /** A mute's actions post to Chat only (D-037). */
  channels?: 'Chat and email' | 'Chat';
}) {
  const seconds = useSecondsLeft(postsAt);
  const [undoing, setUndoing] = useState(false);
  if (seconds <= 0) return <span>{`Posted to ${channels}.`}</span>;
  return (
    <span className="flex flex-wrap items-center gap-3">
      <span>{`Posting to ${channels} in ${seconds} s — nothing is sent until then`}</span>
      <Button
        variant="secondary"
        size="sm"
        touchHeight
        icon={<IconRotateCcw />}
        loading={undoing}
        onClick={() => {
          setUndoing(true);
          void Promise.resolve(onUndo()).finally(() => setUndoing(false));
        }}
      >
        {`Undo · ${seconds} s`}
      </Button>
    </span>
  );
}
