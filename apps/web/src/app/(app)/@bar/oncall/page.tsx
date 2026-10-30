import { PhoneBar } from '@/components/app-shell/phone-bar';
import { phoneBarFor } from '@/components/app-shell/phone-bar-routes';

/** On-call: the phone top bar (D-045) — a bottom-nav tab, so the title and no back arrow. */
export default function OncallBar() {
  return <PhoneBar {...phoneBarFor('/oncall')} />;
}
