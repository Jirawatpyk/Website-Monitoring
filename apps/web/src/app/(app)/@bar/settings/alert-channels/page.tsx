import { PhoneBar } from '@/components/app-shell/phone-bar';
import { phoneBarFor } from '@/components/app-shell/phone-bar-routes';

/** Settings › Alert channels: the phone top bar (D-045, §35.1). */
export default function SettingsAlertChannelsBar() {
  return <PhoneBar {...phoneBarFor('/settings/alert-channels')} />;
}
