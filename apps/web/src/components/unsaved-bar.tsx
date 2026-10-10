import { Button } from '@jirawatpyk/aura-react';
import { IconCheck, IconPencil } from '@jirawatpyk/aura-react/icons';

/**
 * The settings save model (spec §13): "N unsaved changes · Discard · Save" as a sticky bar, shown only
 * when something changed (Escalation board; Organisation, Alert channels and Security reuse it).
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
    <div
      role="region"
      aria-label="Unsaved changes"
      className="sticky bottom-4 z-10 flex items-center gap-3 rounded-full border border-border-strong bg-bg-surface py-2.5 pr-2.5 pl-5 shadow-aura-overlay"
    >
      <span className="flex text-fg-secondary" aria-hidden>
        <IconPencil size="sm" />
      </span>
      <span className="font-semibold whitespace-nowrap">{label}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-fg-secondary">{hint}</span>
      <Button variant="ghost" size="sm" onClick={onDiscard}>
        Discard
      </Button>
      <Button variant="primary" size="sm" icon={<IconCheck />} onClick={onSave}>
        Save
      </Button>
    </div>
  );
}
