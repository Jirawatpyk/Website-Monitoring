import { PhoneBar } from '@/components/app-shell/phone-bar';
import { phoneBarFor } from '@/components/app-shell/phone-bar-routes';

/** Settings › Sign-in & security: the phone top bar (D-045, §35.1). */
export default function SettingsSecurityBar() {
  return <PhoneBar {...phoneBarFor('/settings/security')} />;
}
