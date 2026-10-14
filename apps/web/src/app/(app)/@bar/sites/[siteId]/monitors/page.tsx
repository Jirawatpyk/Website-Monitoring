import { PhoneBar } from '@/components/app-shell/phone-bar';
import { phoneBarFor } from '@/components/app-shell/phone-bar-routes';

/** Edit monitors's phone top bar (D-045): back to the site, the page title. */
export default async function SitesMonitorsBar({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  return <PhoneBar {...phoneBarFor(`/sites/${siteId}/monitors`)} />;
}
