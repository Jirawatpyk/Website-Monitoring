import { ActionBar, Button } from '@jirawatpyk/aura-react';
import { IconCheck } from '@jirawatpyk/aura-react/icons';

/**
 * The settings save model (spec §13): "N unsaved changes · Discard · Save" as a sticky bar, shown only
 * when something changed (Escalation board; Organisation, Alert channels and Security reuse it). Built
 * on AURA ActionBar: it sticks above a BottomNav, its status line is announced, its buttons are 44 px
 * on touch. The board draws a pill with a pencil; ActionBar's own shape stands in (spec-check B1).
 */
export function UnsavedBar({
  label,
  hint,
  onDiscard,
  onSave,
}: {
  label: string;
  hint?: string;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <ActionBar
      label="Unsaved changes"
      status={
        <span>
          <span className="font-semibold">{label}</span>
          {hint ? <span className="text-fg-secondary"> · {hint}</span> : null}
        </span>
      }
    >
      <Button variant="ghost" touchHeight onClick={onDiscard}>
        Discard
      </Button>
      <Button variant="primary" icon={<IconCheck />} touchHeight onClick={onSave}>
        Save
      </Button>
    </ActionBar>
  );
}
