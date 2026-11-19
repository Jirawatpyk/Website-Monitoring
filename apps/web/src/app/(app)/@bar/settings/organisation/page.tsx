import { PhoneBar } from '@/components/app-shell/phone-bar';
import { phoneBarFor } from '@/components/app-shell/phone-bar-routes';

/** Settings › Organisation: the phone top bar (D-045, §35.1). */
export default function SettingsOrganisationBar() {
  return <PhoneBar {...phoneBarFor('/settings/organisation')} />;
}
