import { PhoneBar } from '@/components/app-shell/phone-bar';
import { phoneBarFor } from '@/components/app-shell/phone-bar-routes';

/** Incidents (a tab): the phone top bar (D-045). */
export default function IncidentsBar() {
  return <PhoneBar {...phoneBarFor('/incidents')} />;
}
