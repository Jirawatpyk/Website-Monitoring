import { Avatar, Card } from '@jirawatpyk/aura-react';
import { IconUsers } from '@jirawatpyk/aura-react/icons';
import Link from 'next/link';
import type { OncallCard as OncallCardData } from '../model';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring';

/**
 * Overview "On call" (§23.8, Main3): who responds now, tonight and next week, the Tier 2–3 hours, and
 * "Rotation →" to On-call. Desktop and tablet only (MOverview4 draws none).
 */
export function OncallCard({ card }: { card: OncallCardData }) {
  return (
    <Card className="min-w-0 flex-1">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="m-0 text-base font-semibold">On call</h3>
          <Link href="/oncall" className={`rounded-aura-sm text-sm whitespace-nowrap ${FOCUS}`}>
            Rotation →
          </Link>
        </div>
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-sm leading-snug">
          {card.lines.map((l) => (
            <li key={l.text} className="flex items-center gap-2.5">
              {l.who ? (
                <Avatar name={l.who} size="sm" />
              ) : (
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong text-fg-tertiary">
                  <IconUsers size="sm" />
                </span>
              )}
              <span className="grow">{l.text}</span>
              <span className="whitespace-nowrap text-fg-secondary">{l.when}</span>
            </li>
          ))}
        </ul>
        <span className="text-xs leading-normal text-fg-secondary">{card.foot}</span>
      </div>
    </Card>
  );
}
