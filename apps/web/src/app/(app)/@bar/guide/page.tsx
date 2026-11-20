import { PhoneBar } from '@/components/app-shell/phone-bar';
import { phoneBarFor } from '@/components/app-shell/phone-bar-routes';

/** User guide: the phone top bar (D-045) — back to the topic list from an open topic (MGuide). */
export default async function GuideBar({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { topic } = await searchParams;
  return <PhoneBar {...phoneBarFor('/guide', { topic: typeof topic === 'string' ? topic : null })} />;
}
