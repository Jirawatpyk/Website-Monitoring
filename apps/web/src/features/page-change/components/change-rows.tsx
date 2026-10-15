'use client';

import { useState } from 'react';
import { Badge, Button } from '@jirawatpyk/aura-react';
import type { ChangeRowView, FingerprintRowView } from '../model';

/**
 * The What changed rows (spec §26.4, Incident / SiteDetail boards): field name · Was (muted) · Now
 * (emphasised), long values wrap and never end in "…"; a domain set as chips — "+ domain" added in the
 * danger tone, "− domain" removed muted and struck through, the unchanged ones folded into "and N
 * unchanged". Status never by colour alone: "+" / "−" and a screen-reader word on every chip.
 */
export function ChangeRows({ rows }: { rows: readonly ChangeRowView[] }) {
  return (
    <dl className="m-0 flex flex-col">
      {rows.map((r) => (
        <Row key={r.field} label={r.label}>
          {r.kind === 'text' ? (
            <span className="flex flex-col gap-1">
              <span className="text-sm break-words text-fg-secondary">
                <span className="me-2 text-xs text-fg-tertiary">Was</span>
                {r.was ?? '(none)'}
              </span>
              <span className="text-sm font-medium break-words">
                <span className="me-2 text-xs font-normal text-fg-tertiary">Now</span>
                {r.now ?? '(none)'}
              </span>
            </span>
          ) : (
            <Domains added={r.added} removed={r.removed} unchanged={r.unchanged} />
          )}
        </Row>
      ))}
    </dl>
  );
}

/** "Show fingerprint": every field's value (Recording, Matches, No data). */
export function FingerprintRows({ rows }: { rows: readonly FingerprintRowView[] }) {
  return (
    <dl className="m-0 flex flex-col">
      {rows.map((r) => (
        <Row key={r.field} label={r.label}>
          {r.kind === 'text' ? (
            <span className="text-sm break-words">{r.value ?? '(none)'}</span>
          ) : r.domains.length ? (
            <Domains added={[]} removed={[]} unchanged={r.domains} folded={false} />
          ) : (
            <span className="text-sm text-fg-secondary">(none)</span>
          )}
        </Row>
      ))}
    </dl>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-border-subtle py-2.5 last:border-b-0 md:grid-cols-[calc(var(--spacing)*44)_minmax(0,1fr)] md:gap-4">
      <dt className="text-sm text-fg-secondary">{label}</dt>
      <dd className="m-0 min-w-0">{children}</dd>
    </div>
  );
}

function Domains({
  added,
  removed,
  unchanged,
  folded = true,
}: {
  added: readonly string[];
  removed: readonly string[];
  unchanged: readonly string[];
  folded?: boolean;
}) {
  const [open, setOpen] = useState(!folded);
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {added.map((d) => (
        <Badge key={`+${d}`} tone="danger" variant="soft">
          {`+ ${d}`}
          <span className="sr-only"> (new)</span>
        </Badge>
      ))}
      {removed.map((d) => (
        <Badge key={`-${d}`} tone="neutral" variant="outline" className="text-fg-secondary line-through">
          {`− ${d}`}
          <span className="sr-only"> (removed)</span>
        </Badge>
      ))}
      {open &&
        unchanged.map((d) => (
          <Badge key={d} tone="neutral" variant="outline">
            {d}
          </Badge>
        ))}
      {folded && unchanged.length > 0 && (
        <Button variant="ghost" size="sm" touchHeight aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide unchanged' : `and ${unchanged.length} unchanged`}
        </Button>
      )}
    </span>
  );
}
