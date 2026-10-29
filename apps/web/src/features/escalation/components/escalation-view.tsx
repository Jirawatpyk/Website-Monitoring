'use client';

import { Alert, Badge, SegmentedControl, Select } from '@jirawatpyk/aura-react';
import { IconBell, IconEye, IconLock, IconMail, IconUsers } from '@jirawatpyk/aura-react/icons';
import type { EscalationChannel } from '@dxt/shared';
import { useMemo, useState, type ReactElement } from 'react';
import { stepCondition, stepNote, targetLabels, type PolicyDraft } from '../model';
import { hoursLabel, hoursOf, nobodyWhy, scenario, stepNames } from '../preview';

const upperFirst = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
import type { EscalationPageData } from '../types';
import { useNow } from '../use-now';

const CH: Record<EscalationChannel, { label: string; icon: ReactElement }> = {
  chat: { label: 'Chat @mention', icon: <IconBell /> },
  space: { label: 'Alerts Space', icon: <IconUsers /> },
  email: { label: 'Email', icon: <IconMail /> },
  voice: { label: 'Voice · off', icon: <IconLock /> },
};
const CH_ORDER: readonly EscalationChannel[] = ['chat', 'space', 'email', 'voice'];

type ViewKey = 't1' | 't23' | 'problem';
const VIEWS: { value: ViewKey; label: string }[] = [
  { value: 't1', label: 'Tier 1 DOWN' },
  { value: 't23', label: 'Tier 2–3 DOWN' },
  { value: 'problem', label: 'PROBLEM' },
];

/**
 * MEscalation (spec §22.5–6, D-034): the policies read-only — on phones for everyone, and at every
 * width for anyone who isn't an Admin. One vertical ladder with names resolved for the picked site,
 * "Example · nobody acknowledges" and "Always true", with the S10 L2 / L3 rows (on-call: S10 PR B).
 */
export function EscalationView({
  data,
  now,
  admin,
}: {
  data: EscalationPageData;
  now: string;
  /** An Admin on a phone: the banner says where to edit. */
  admin: boolean;
}) {
  const [view, setView] = useState<ViewKey>('t1');
  const [siteId, setSiteId] = useState<string | null>(null);
  const hours = useMemo(() => hoursOf(data.hours), [data.hours]);
  const clock = useNow(now);
  const find = (k: PolicyDraft['key']) => data.policies.find((p) => p.key === k);
  // "Tier 2–3 DOWN" lists both tiers' sites; the ladder is the picked site's tier (Tier 2 and 3 are
  // stored apart, D-034).
  const candidates =
    view === 't1'
      ? data.sites.filter((s) => s.tier === 1)
      : view === 'problem'
        ? data.sites
        : data.sites.filter((s) => s.tier !== 1);
  const site = candidates.find((s) => s.id === siteId) ?? candidates[0];
  const policy =
    view === 't1' ? find('t1') : view === 'problem' ? find('problem') : find(site?.tier === 3 ? 't3' : 't2');
  if (!policy) throw new Error('No escalation policies — the S08 migration seeds four');
  const fyiStep = policy.steps.find((s) => s.fyi);
  const example = scenario(policy, site, data.admins, hours, clock, {
    phone: true,
    reminderMin: policy.severity === 'down' ? data.downReminder : data.problemReminder,
  });
  const title =
    view === 't1'
      ? `Tier 1 DOWN · ${candidates.length} site${candidates.length === 1 ? '' : 's'}`
      : view === 't23'
        ? `Tier 2–3 DOWN · ${candidates.length} site${candidates.length === 1 ? '' : 's'}`
        : `PROBLEM · all ${candidates.length} site${candidates.length === 1 ? '' : 's'}`;
  const sub =
    view === 't1'
      ? '24/7. The owner is @mentioned first.'
      : view === 't23'
        ? `Posted at any hour; outside ${hoursLabel(data.hours)} the timers wait until the next opening. No CEO page.`
        : 'Tier 2–3 outside response hours are held until the next opening.';

  return (
    <div className="flex flex-col gap-3">
      <Alert tone="info" role="note" icon={<IconEye />} title={admin ? 'View only on phones.' : 'View only.'}>
        {admin
          ? 'Admins change policies on a larger screen.'
          : 'Only an Admin can change escalation policies.'}
      </Alert>

      <SegmentedControl
        label="Policy"
        value={view}
        onChange={(v) => setView(v as ViewKey)}
        options={VIEWS}
        size="sm"
        fullWidth
      />

      <div className="flex flex-col gap-0.5 px-0.5">
        <h2 className="m-0 text-base font-semibold">{title}</h2>
        <p className="m-0 text-sm text-fg-secondary">{sub}</p>
      </div>

      {!site && (
        <p className="m-0 rounded-aura-md border border-border-default bg-bg-surface px-3 py-2.5 text-sm text-fg-secondary">
          No live sites here yet — names show once one is monitored.
        </p>
      )}
      {site && (
        <Select
          label="Show names for"
          touchHeight
          options={candidates.map((s) => ({ value: s.id, label: `${s.name} · Tier ${s.tier}` }))}
          value={site?.id ?? ''}
          onChange={(e) => setSiteId(e.target.value)}
        />
      )}

      <ol
        role="list"
        className="m-0 flex list-none flex-col rounded-aura-lg border border-border-default bg-bg-surface p-3.5 pl-3"
      >
        {policy.steps.map((s, i) => {
          const names = site ? stepNames(policy.steps, i, site, data.admins) : targetLabels(s, data.admins);
          const note = stepNote(policy, s, true);
          return (
            <li key={s.level} className="group relative flex gap-3">
              <div className="flex w-9 shrink-0 flex-col items-center" aria-hidden>
                <span className="flex size-9 items-center justify-center rounded-full border border-border-control bg-bg-surface font-mono text-xs font-semibold">
                  L{s.level}
                </span>
                {i < policy.steps.length - 1 && <span className="min-h-3.5 w-0.5 flex-1 bg-border-default" />}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5 pb-3.5 group-last:pb-0">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">
                    <span className="sr-only">L{s.level}: </span>
                    {s.level === 0 ? 'Immediately' : `+${s.delayMin} min`}
                  </span>
                  <span className="text-right text-xs text-fg-secondary">
                    {stepCondition(policy, s, true)}
                  </span>
                </span>
                <span>
                  {names.join(' + ') || upperFirst(nobodyWhy(s, site, data.admins))}
                  {s.channels.includes('space') ? ' + Alerts Space' : ''}
                </span>
                {site && (
                  <span className="text-xs text-fg-secondary">
                    {targetLabels(s, data.admins).join(' + ')}
                  </span>
                )}
                <span className="flex flex-wrap gap-1 pt-0.5">
                  {CH_ORDER.filter((c) => s.channels.includes(c)).map((c) => (
                    <Badge key={c} tone="neutral" variant="outline" icon={CH[c].icon}>
                      {CH[c].label}
                    </Badge>
                  ))}
                </span>
                {note && <span className="text-xs text-fg-secondary">{note}</span>}
              </div>
            </li>
          );
        })}
      </ol>

      <section className="flex flex-col gap-2 rounded-aura-lg border border-border-default bg-bg-surface px-3.5 py-3 text-sm">
        <h2 className="m-0 font-mono text-xs font-normal text-fg-tertiary">EXAMPLE · NOBODY ACKNOWLEDGES</h2>
        <p className="m-0 text-fg-secondary">{example.caseLine}</p>
        <ol role="list" className="m-0 flex list-none flex-col gap-2 p-0">
          {example.rows.map((r) => (
            <li key={`${r.at}${r.what}`} className="flex gap-2.5">
              <span className="w-20 shrink-0 font-mono text-xs whitespace-nowrap text-fg-secondary">
                {r.at}
              </span>
              <span className={r.danger ? 'text-fg-danger' : r.muted ? 'text-fg-secondary' : undefined}>
                {r.what}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-1.5 rounded-aura-lg border border-border-default bg-bg-surface px-3.5 py-3 text-sm">
        <h2 className="m-0 font-mono text-xs font-normal text-fg-tertiary">ALWAYS TRUE</h2>
        <p className="m-0">
          {fyiStep
            ? `Acknowledge stops the steps above up to L${fyiStep.level - 1} (L${fyiStep.level} is the FYI).`
            : 'Acknowledge stops the steps above.'}
        </p>
        <p className="m-0">
          Reminders in the thread: DOWN every {data.downReminder} min · PROBLEM every {data.problemReminder}{' '}
          min.
        </p>
        <p className="m-0">Response hours Tier 2–3: {hoursLabel(data.hours)}.</p>
      </section>
    </div>
  );
}
