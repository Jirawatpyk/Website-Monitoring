import { PhoneBar } from '@/components/app-shell/phone-bar';
import { phoneBarFor } from '@/components/app-shell/phone-bar-routes';

/** Audit log: the phone top bar (D-045). */
export default function AuditBar() {
  return <PhoneBar {...phoneBarFor('/audit')} />;
}
