import { PhoneBar } from '@/components/app-shell/phone-bar';
import { phoneBarFor } from '@/components/app-shell/phone-bar-routes';
import { SiteMoreMenu } from '@/features/sites';
import { getSiteBar } from '@/features/sites/server';
import { getAccess } from '@/lib/auth/session';

/**
 * Site detail's phone top bar (MSite, D-045): back to Sites, the site's name, the ⋯ menu (Edit site for an
 * Admin on a live site, Visit site for everyone), then the avatar. Both reads are request-cached.
 */
export default async function SiteBar({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  const [site, access] = await Promise.all([getSiteBar(siteId), getAccess()]);
  const fallback = phoneBarFor(`/sites/${siteId}`);
  if (!site) return <PhoneBar {...fallback} />;
  const isAdmin = access.status === 'active' && access.profile.role === 'admin';
  return (
    <PhoneBar
      title={site.name}
      back={fallback.back}
      actions={
        <SiteMoreMenu siteId={siteId} name={site.name} url={site.url} canEdit={isAdmin && site.live} phone />
      }
    />
  );
}
