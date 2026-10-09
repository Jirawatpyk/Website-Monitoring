'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { SegmentedControl } from '@jirawatpyk/aura-react';
import { DEFAULT_RANGE, SITE_RANGE_KEYS, SITE_RANGES, type SiteRange } from '../../detail';

/** Availability range (24 h / 7 d / 30 d / 90 d), kept in `?range=` so it survives a reload or a link. */
export function RangeControl({ value, fullWidth = false }: { value: SiteRange; fullWidth?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [, start] = useTransition();
  return (
    <SegmentedControl
      label="Range"
      size="sm"
      fullWidth={fullWidth}
      value={value}
      options={SITE_RANGE_KEYS.map((k) => ({ value: k, label: SITE_RANGES[k].label }))}
      onChange={(v) =>
        start(() =>
          router.replace(v === DEFAULT_RANGE ? pathname : `${pathname}?range=${v}`, { scroll: false }),
        )
      }
    />
  );
}
