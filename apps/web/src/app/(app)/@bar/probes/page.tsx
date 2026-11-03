import { PhoneBar } from '@/components/app-shell/phone-bar';
import { phoneBarFor } from '@/components/app-shell/phone-bar-routes';

/** Probes & heartbeat: the phone top bar (D-045). */
export default function ProbesBar() {
  return <PhoneBar {...phoneBarFor('/probes')} />;
}
