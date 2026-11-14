'use client';

import Link from 'next/link';
import { PageHeader, Tabs } from '@jirawatpyk/aura-react';

/** Settings pages built so far (S17 adds Alert channels and Organisation; Phase 3 API & webhooks). */
export const SETTINGS_TABS = [
  { id: 'users', label: 'Users & roles', href: '/settings/users' },
  { id: 'security', label: 'Sign-in & security', href: '/settings/security' },
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number]['id'];

/**
 * The Settings pages' header (Users / Security boards): eyebrow SETTINGS, the page's one action, and the
 * section tabs as links. Below md the tabs are the segmented control under the top bar (§35.1).
 */
export function SettingsHeader({ current, actions }: { current: SettingsTab; actions?: React.ReactNode }) {
  const tabs = SETTINGS_TABS.map((t) => ({ id: t.id, label: t.label, href: t.href }));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader titleHideBelow="lg" eyebrow="SETTINGS" title="Settings" actions={actions} />
      <div className="hidden md:block">
        <Tabs label="Settings pages" tabs={tabs} value={current} linkComponent={Link} />
      </div>
      <div className="md:hidden">
        <Tabs
          label="Settings pages"
          tabs={tabs}
          value={current}
          linkComponent={Link}
          variant="segmented"
          fullWidth
          touchHeight="always"
        />
      </div>
    </div>
  );
}
