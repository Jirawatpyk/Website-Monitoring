import type { ReactNode } from 'react';
import Link from 'next/link';
import { IconArrowLeft } from '@jirawatpyk/aura-react/icons';
import { BrandMark } from './brand';
import type { PhoneBarSpec } from './phone-bar-routes';

/**
 * The left part of the phone top bar (spec §22.1, D-045): a back arrow off the bottom-nav tabs, then the
 * page's title — or the brand on Overview — then the page's own phone buttons (Site detail's ⋯). Rendered
 * on the server by the `@bar` slot, so the title is there on first paint; `MobileBar` adds the avatar.
 */
export function PhoneBar({ title, back, actions }: PhoneBarSpec & { actions?: ReactNode }) {
  return (
    <>
      {back && (
        <Link
          href={back.href}
          aria-label={back.label}
          className="flex size-11 shrink-0 items-center justify-center rounded-aura-md text-fg-primary hover:bg-bg-surface-hover"
        >
          <IconArrowLeft aria-hidden className="size-5" />
        </Link>
      )}
      {title === null ? (
        <BrandMark compact />
      ) : (
        // Not a heading: the page keeps its h1 in <main> (visually hidden below lg).
        <p className="m-0 min-w-0 grow truncate text-base font-semibold">{title}</p>
      )}
      {actions && <span className="flex shrink-0 items-center">{actions}</span>}
    </>
  );
}
