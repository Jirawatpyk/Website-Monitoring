import { PhoneBar } from '@/components/app-shell/phone-bar';
import { phoneBarFor } from '@/components/app-shell/phone-bar-routes';

/** Sites (a tab): the phone top bar (D-045). */
export default function SitesBar() {
  return <PhoneBar {...phoneBarFor('/sites')} />;
}
