import { PhoneBar } from '@/components/app-shell/phone-bar';
import { phoneBarFor } from '@/components/app-shell/phone-bar-routes';

/** While the site's name loads, the bar already has its back arrow and a generic title (D-045). */
export default function SiteBarLoading() {
  return <PhoneBar {...phoneBarFor('/sites/_')} />;
}
