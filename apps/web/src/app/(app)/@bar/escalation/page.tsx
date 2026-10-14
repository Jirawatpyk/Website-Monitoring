import { PhoneBar } from '@/components/app-shell/phone-bar';
import { phoneBarFor } from '@/components/app-shell/phone-bar-routes';

/** Escalation policies: the phone top bar (D-045). */
export default function EscalationBar() {
  return <PhoneBar {...phoneBarFor('/escalation')} />;
}
