import { PhoneBar } from '@/components/app-shell/phone-bar';
import { phoneBarFor } from '@/components/app-shell/phone-bar-routes';

/** Add site: the phone top bar (D-045). */
export default function SitesNewBar() {
  return <PhoneBar {...phoneBarFor('/sites/new')} />;
}
