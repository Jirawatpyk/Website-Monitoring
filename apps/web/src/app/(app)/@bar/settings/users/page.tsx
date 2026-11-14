import { PhoneBar } from '@/components/app-shell/phone-bar';
import { phoneBarFor } from '@/components/app-shell/phone-bar-routes';

/** Settings › Users & roles: the phone top bar (D-045, §35.1). */
export default function SettingsUsersBar() {
  return <PhoneBar {...phoneBarFor('/settings/users')} />;
}
