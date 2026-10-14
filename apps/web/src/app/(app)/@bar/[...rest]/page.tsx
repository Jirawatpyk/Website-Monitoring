import { PhoneBar } from '@/components/app-shell/phone-bar';
import { phoneBarFor } from '@/components/app-shell/phone-bar-routes';

/**
 * The phone top bar of every page whose title needs no data (D-045): the tabs, Add site, Edit site, Edit
 * monitors, Maintenance, Escalation. A page that names its own (Site detail, Incident) has its own slot page.
 */
export default async function PageBar({ params }: { params: Promise<{ rest: string[] }> }) {
  const { rest } = await params;
  return <PhoneBar {...phoneBarFor(`/${rest.join('/')}`)} />;
}
