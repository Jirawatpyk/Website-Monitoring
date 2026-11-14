import { PhoneBar } from '@/components/app-shell/phone-bar';
import { phoneBarFor } from '@/components/app-shell/phone-bar-routes';

/** My profile: the phone top bar (D-045, MProfile: back to Overview, "My profile"). */
export default function ProfileBar() {
  return <PhoneBar {...phoneBarFor('/profile')} />;
}
