'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useOptimistic, useTransition, type ReactNode } from 'react';
import { SegmentedControl } from '@jirawatpyk/aura-react';
import { DEFAULT_RANGE, SITE_RANGE_KEYS, SITE_RANGES, type SiteRange } from '../../detail';

interface RangeState {
  value: SiteRange;
  pending: boolean;
  choose: (v: SiteRange) => void;
}
const RangeContext = createContext<RangeState | null>(null);

/**
 * The page's range (24 h / 7 d / 30 d / 90 d), kept in `?range=` so it survives a reload or a link.
 * The choice shows at once (optimistic) and the figures that depend on it dim until the server answers.
 */
export function RangeProvider({ value, children }: { value: SiteRange; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [shown, setShown] = useOptimistic(value);
  const choose = (v: SiteRange) =>
    start(() => {
      setShown(v);
      router.replace(v === DEFAULT_RANGE ? pathname : `${pathname}?range=${v}`, { scroll: false });
    });
  return <RangeContext.Provider value={{ value: shown, pending, choose }}>{children}</RangeContext.Provider>;
}

function useRange(): RangeState {
  const ctx = useContext(RangeContext);
  if (!ctx) throw new Error('RangeControl needs a RangeProvider');
  return ctx;
}

export function RangeControl({ fullWidth = false }: { fullWidth?: boolean }) {
  const { value, choose } = useRange();
  return (
    <SegmentedControl
      label="Range"
      size="sm"
      fullWidth={fullWidth}
      value={value}
      options={SITE_RANGE_KEYS.map((k) => ({ value: k, label: SITE_RANGES[k].label }))}
      onChange={(v) => choose(v as SiteRange)}
    />
  );
}

/** Figures that follow the range: busy and dimmed while a new range loads. */
export function RangeDependent({ children, className = '' }: { children: ReactNode; className?: string }) {
  const { pending } = useRange();
  return (
    <div
      aria-busy={pending}
      className={`transition-opacity motion-reduce:transition-none ${pending ? 'opacity-60' : ''} ${className}`}
    >
      {children}
    </div>
  );
}
