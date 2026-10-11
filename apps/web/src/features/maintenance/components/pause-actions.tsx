'use client';

import type { WindowKind } from '@dxt/engine';
import { Button } from '@jirawatpyk/aura-react';
import { IconCalendar, IconEyeOff } from '@jirawatpyk/aura-react/icons';
import { useState } from 'react';
import type { PausableSite } from '../model';
import { MaintenanceDialog } from './maintenance-dialog';

/**
 * Site detail's "Mute" and "Schedule maintenance" buttons (boards SiteDetail, MSite) and the dialog they
 * open. A site already muted or in maintenance is ended or edited on Maintenance & mutes (§23).
 */
export function PauseActions({
  site,
  isAdmin,
  viewerName,
  viewerEmail,
}: {
  site: PausableSite;
  isAdmin: boolean;
  viewerName: string;
  viewerEmail: string;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<WindowKind>('mute');
  const [n, setN] = useState(0);
  const [now] = useState(() => Date.now());
  const muted = !!site.mutedUntil && Date.parse(site.mutedUntil) > now;
  const show = (k: WindowKind) => {
    setN((x) => x + 1);
    setKind(k);
    setOpen(true);
  };
  return (
    <>
      {muted ? (
        <Button variant="secondary" icon={<IconEyeOff />} href="/maintenance">
          End or edit mute…
        </Button>
      ) : (
        <Button variant="secondary" icon={<IconEyeOff />} onClick={() => show('mute')}>
          Mute
        </Button>
      )}
      {site.status === 'maintenance' ? (
        <Button variant="secondary" icon={<IconCalendar />} href="/maintenance">
          End or edit maintenance…
        </Button>
      ) : (
        <Button variant="secondary" icon={<IconCalendar />} onClick={() => show('maintenance')}>
          <span className="max-md:hidden">Schedule maintenance</span>
          <span className="md:hidden">Maintenance</span>
        </Button>
      )}
      <MaintenanceDialog
        key={n}
        open={open}
        onClose={() => setOpen(false)}
        sites={[site]}
        siteId={site.id}
        kind={kind}
        isAdmin={isAdmin}
        viewerName={viewerName}
        viewerEmail={viewerEmail}
      />
    </>
  );
}
