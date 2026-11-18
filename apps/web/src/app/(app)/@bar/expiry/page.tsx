import { PhoneBar } from '@/components/app-shell/phone-bar';
import { phoneBarFor } from '@/components/app-shell/phone-bar-routes';

/** SSL & domains: the phone top bar (D-045). */
export default function ExpiryBar() {
  return <PhoneBar {...phoneBarFor('/expiry')} />;
}
