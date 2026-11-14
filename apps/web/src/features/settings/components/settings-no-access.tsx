import { Button } from '@jirawatpyk/aura-react';
import { IconArrowLeft } from '@jirawatpyk/aura-react/icons';
import { ROLE_LABELS, type Role } from '@dxt/shared';
import { NoAccess } from '@/components/states';
import { SettingsHeader, type SettingsTab } from './settings-header';

/**
 * Settings for anyone but an Admin (§35, MSecurity "No access"): the shared notice with who you are,
 * and the way back. The SQL functions refuse them anyway.
 */
export function SettingsNoAccess({
  current,
  viewer,
}: {
  current: SettingsTab;
  viewer: { name: string; role: Role } | null;
}) {
  const who = viewer ? `You’re signed in as ${viewer.name} (${ROLE_LABELS[viewer.role]}). ` : '';
  return (
    <div className="flex flex-col gap-6">
      <SettingsHeader current={current} />
      <NoAccess
        title="Only Admins can see Settings"
        description={`${who}Ask an Admin if something here needs to change.`}
      />
      <div>
        <Button variant="secondary" icon={<IconArrowLeft />} href="/" fullWidth="below-md">
          Back to Overview
        </Button>
      </div>
    </div>
  );
}
