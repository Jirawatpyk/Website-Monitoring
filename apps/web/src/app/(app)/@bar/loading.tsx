'use client';

import { usePathname } from 'next/navigation';
import { PhoneBar } from '@/components/app-shell/phone-bar';
import { phoneBarFor } from '@/components/app-shell/phone-bar-routes';

/**
 * The bar's own loading state. Without it the slot inherits `(app)/loading.tsx` — the Overview skeleton —
 * and the top bar grew to 600 px while a page streamed (found by /verify, D-045). It shows the bar of the
 * page being opened: an empty bar here blanked the title for ~0.3 s on a tab switch (Sites → Incidents,
 * 15 Oct). Site detail and Incident have their own loading bar.
 */
export default function BarLoading() {
  return <PhoneBar {...phoneBarFor(usePathname())} />;
}
