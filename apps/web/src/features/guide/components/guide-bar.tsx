'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { PhoneBar } from '@/components/app-shell/phone-bar';
import { phoneBarFor } from '@/components/app-shell/phone-bar-routes';
import { PHONE_TOPIC_IDS } from '../content';
import { setGuideTopic } from './guide-page';

/**
 * The User guide's phone top bar (MGuide, D-045): back to the topic list while a topic is open, back
 * to the Overview from the list. Follows `?topic=` on the client, as the page opens topics without a
 * navigation; an unknown topic id is the list.
 */
export function GuideBar() {
  const pathname = usePathname();
  const raw = useSearchParams().get('topic');
  const topic = raw && PHONE_TOPIC_IDS.includes(raw) ? raw : null;
  return (
    <PhoneBar
      {...phoneBarFor('/guide', { topic })}
      onBack={topic ? () => setGuideTopic(pathname, null) : undefined}
    />
  );
}
