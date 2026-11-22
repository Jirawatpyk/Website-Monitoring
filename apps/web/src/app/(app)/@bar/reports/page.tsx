import { PhoneBar } from '@/components/app-shell/phone-bar';
import { phoneBarFor } from '@/components/app-shell/phone-bar-routes';

/** Uptime reports: the phone top bar (D-045). */
export default function ReportsBar() {
  return <PhoneBar {...phoneBarFor('/reports')} />;
}
