'use client';

import { Tooltip } from '@jirawatpyk/aura-react';
import { IconRotateCcw } from '@jirawatpyk/aura-react/icons';
import { CHECK_KIND_WORDS, type CheckKind } from '../../detail';

/**
 * Spec §29.2: what kind of check a Check log row is, under its time — none for the round's own check, ↻
 * "Recheck", an outlined "Confirm" pill, or the pill with ↻ for a confirm's recheck. Shape tells them
 * apart, never colour; all neutral.
 */
function Glyph({ kind }: { kind: Exclude<CheckKind, 'scheduled'> }) {
  const confirm = kind === 'confirm' || kind === 'confirm_recheck';
  const recheck = kind === 'recheck' || kind === 'confirm_recheck';
  return (
    <span className="inline-flex h-4 items-center gap-1 text-xs leading-none text-fg-secondary">
      {confirm && (
        <span className="inline-flex h-4 items-center rounded-full border border-border-strong px-1.5 font-medium text-fg-primary">
          Confirm
        </span>
      )}
      {recheck && (
        <span className="inline-flex items-center gap-1">
          <IconRotateCcw size={12} aria-hidden />
          {kind === 'recheck' && 'Recheck'}
        </span>
      )}
    </span>
  );
}

/** Desktop: the mark is focusable and its tooltip explains it (spec §29.3). */
export function CheckMark({ kind }: { kind: CheckKind }) {
  if (kind === 'scheduled') return null;
  const words = CHECK_KIND_WORDS[kind];
  return (
    <Tooltip content={words.text} side="bottom">
      <span role="img" tabIndex={0} aria-label={words.name} className="inline-flex rounded-aura-sm">
        <Glyph kind={kind} />
      </span>
    </Tooltip>
  );
}

/** Phones: the same mark, not focusable — the key under the rows explains it (spec §29.4). */
export function CheckMarkStatic({ kind }: { kind: CheckKind }) {
  if (kind === 'scheduled') return null;
  return (
    <span role="img" aria-label={CHECK_KIND_WORDS[kind].name} className="inline-flex">
      <Glyph kind={kind} />
    </span>
  );
}

/** Phones: one line per kind that appears in the list, with the tooltip's sentence (spec §29.4). */
export function CheckKey({ kinds }: { kinds: readonly CheckKind[] }) {
  const shown = (['recheck', 'confirm', 'confirm_recheck'] as const).filter((k) => kinds.includes(k));
  if (!shown.length) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-2 border-b border-border-subtle bg-bg-canvas px-3.5 py-2.5 text-xs text-fg-secondary">
      {shown.map((k) => (
        <li key={k} className="flex flex-col items-start gap-1">
          <span aria-hidden>
            <Glyph kind={k} />
          </span>
          <span>{CHECK_KIND_WORDS[k].text}</span>
        </li>
      ))}
    </ul>
  );
}
