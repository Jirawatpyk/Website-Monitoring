import { PhoneBar } from '@/components/app-shell/phone-bar';
import { phoneBarFor } from '@/components/app-shell/phone-bar-routes';

/** While the INC number loads, the bar already has its back arrow and a generic title (D-045). */
export default function IncidentBarLoading() {
  return <PhoneBar {...phoneBarFor('/incidents/_')} />;
}
