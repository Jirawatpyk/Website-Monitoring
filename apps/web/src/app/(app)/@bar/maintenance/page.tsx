import { PhoneBar } from '@/components/app-shell/phone-bar';
import { phoneBarFor } from '@/components/app-shell/phone-bar-routes';

/** Maintenance & mutes: the phone top bar (D-045). */
export default function MaintenanceBar() {
  return <PhoneBar {...phoneBarFor('/maintenance')} />;
}
