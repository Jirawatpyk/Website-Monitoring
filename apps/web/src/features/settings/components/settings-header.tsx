'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader, Select, Tabs } from '@jirawatpyk/aura-react';

/** Settings pages built so far, in the boards' order (S17 PR 2 adds Alert channels; Phase 3 API & webhooks). */
export const SETTINGS_TABS = [
  { id: 'users', label: 'Users & roles', href: '/settings/users' },
  { id: 'security', label: 'Sign-in & security', href: '/settings/security' },
  { id: 'organisation', label: 'Organisation', href: '/settings/organisation' },
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number]['id'];

/**
 * The Settings pages' header (Users / Security / Organisation boards): eyebrow SETTINGS, the page's one
 * action, and the section tabs as links. Below md three pages no longer fit a segmented control at
 * 390, so the phone gets a select that opens the page picked (§35.1: "then a select").
 */
export function SettingsHeader({ current, actions }: { current: SettingsTab; actions?: React.ReactNode }) {
  const router = useRouter();
  const tabs = SETTINGS_TABS.map((t) => ({ id: t.id, label: t.label, href: t.href }));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader titleHideBelow="lg" eyebrow="SETTINGS" title="Settings" actions={actions} />
      <div className="hidden md:block">
        <Tabs label="Settings pages" tabs={tabs} value={current} linkComponent={Link} />
      </div>
      <div className="md:hidden">
        <Select
          label="Settings page"
          options={SETTINGS_TABS.map((t) => ({ value: t.href, label: t.label }))}
          value={SETTINGS_TABS.find((t) => t.id === current)?.href}
          onChange={(e) => router.push(e.target.value)}
          touchHeight="always"
        />
      </div>
    </div>
  );
}
