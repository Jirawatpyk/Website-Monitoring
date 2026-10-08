'use client';

import { useState } from 'react';
import { Button, Tag, TextField } from '@jirawatpyk/aura-react';
import { IconLock, IconPlus } from '@jirawatpyk/aura-react/icons';

interface PhraseListProps {
  /** The group's name ("Must contain"); the add field is labelled with `addLabel`. */
  title: string;
  addLabel: string;
  placeholder: string;
  phrases: string[];
  onChange: (phrases: string[]) => void;
  hint: string;
  error?: string | undefined;
  /** Normalise a new entry (e.g. lower-case a host); return null to refuse it. */
  clean?: (value: string) => string | null;
  /** A locked chip that can't be removed (none in S05). */
  locked?: string;
}

/** Chips with a remove button and an "Add …" field (EditMonitors content checks and final hosts). */
export function PhraseList({
  title,
  addLabel,
  placeholder,
  phrases,
  onChange,
  hint,
  error,
  clean,
  locked,
}: PhraseListProps) {
  const [draft, setDraft] = useState('');
  const [refused, setRefused] = useState<string>();
  const add = () => {
    const raw = draft.trim();
    if (!raw) return;
    const value = clean ? clean(raw) : raw;
    if (value === null) return setRefused(`“${raw}” isn’t valid here`);
    if (!phrases.includes(value)) onChange([...phrases, value]);
    setDraft('');
    setRefused(undefined);
  };
  return (
    <div role="group" aria-label={title} className="flex flex-col gap-2">
      <span className="text-sm font-medium">{title}</span>
      {(phrases.length > 0 || locked) && (
        <div className="flex flex-wrap gap-1.5">
          {phrases.map((p) => (
            <Tag
              key={p}
              onRemove={() => onChange(phrases.filter((x) => x !== p))}
              removeLabel={`Remove ${p}`}
            >
              {p}
            </Tag>
          ))}
          {locked && <Tag icon={<IconLock />}>{locked}</Tag>}
        </div>
      )}
      <div className="flex items-end gap-2">
        <TextField
          touchHeight
          label={addLabel}
          placeholder={placeholder}
          className="min-w-0 grow"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          error={refused ?? error}
        />
        <Button
          variant="ghost"
          icon={<IconPlus />}
          disabled={!draft.trim()}
          onClick={add}
          aria-label={`Add to ${title}`}
        >
          Add
        </Button>
      </div>
      <span className="text-xs text-fg-secondary">{hint}</span>
    </div>
  );
}
