'use client';

import type { WindowKind } from '@dxt/engine';
import { formatDay, formatIncidentId, formatTier, formatTime, formatWhen } from '@dxt/shared';
import {
  Alert,
  Button,
  Dialog,
  RadioGroup,
  SegmentedControl,
  Select,
  Switch,
  TextField,
  TimePicker,
} from '@jirawatpyk/aura-react';
import { IconCalendar, IconCheck, IconEyeOff, IconInfo } from '@jirawatpyk/aura-react/icons';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useNow } from '@/components/use-now';
import { muteSite, scheduleMaintenance } from '../actions';
import {
  DURATIONS,
  EFFECT,
  GUARD_TEXT,
  GUARD_TEXT_MUTED,
  PROBLEM_WORDS,
  doneOf,
  escalating,
  guardTitle,
  muteRule,
  planOf,
  reasonHint,
  reasonPlaceholder,
  startDays,
  type PausableSite,
} from '../model';

const TYPES = [
  {
    value: 'maintenance',
    label: 'Maintenance window',
    description: 'Planned work. Alerts suppressed; the window is not counted in uptime.',
  },
  {
    value: 'mute',
    label: 'Mute',
    description:
      'Alerts suppressed while you work an issue; still counted in uptime. Up to 24 h, then it ends itself.',
  },
];
const PHONE_TYPES = [
  { value: 'mute', label: 'Mute' },
  { value: 'maintenance', label: 'Maintenance' },
];
const FAILED = 'Couldn’t save. Check your connection and try again.';

/**
 * Schedule maintenance or mute a site (boards Maintenance, MMaintenance; spec §14.5, §15.1; D-036). One
 * dialog at every width: the phone gets MMaintenance's Type switch, "Acknowledge … instead" and the
 * signed-in line. Remount it on each open (`key`) so it starts fresh.
 */
export function MaintenanceDialog({
  open,
  onClose,
  sites,
  siteId,
  kind: initialKind,
  isAdmin,
  viewerName,
  viewerEmail,
  fromPage = false,
}: {
  open: boolean;
  onClose: () => void;
  /** The sites this person may mute or schedule maintenance on. */
  sites: PausableSite[];
  siteId: string;
  kind: WindowKind;
  isAdmin: boolean;
  viewerName: string;
  viewerEmail: string;
  /** Opened from /maintenance: the done state needs no "Open Maintenance & mutes". */
  fromPage?: boolean;
}) {
  const router = useRouter();
  const [openedAt] = useState(() => new Date().toISOString());
  const days = useMemo(() => startDays(new Date(openedAt)), [openedAt]);
  const [site, setSite] = useState(siteId);
  const [kind, setKind] = useState<WindowKind>(initialKind);
  const [later, setLater] = useState(initialKind === 'maintenance');
  const [startDate, setStartDate] = useState(days[1]!.value);
  const [startTime, setStartTime] = useState('22:00');
  const [duration, setDuration] = useState('4 h');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ title: string; text: string } | null>(null);
  const [pending, start] = useTransition();
  // "Starts / Ends" follow the clock while the dialog is open: Save uses the time it is pressed (verify).
  const now = useNow(openedAt, 15_000, open && !done);
  // After Save the form (and its focused button) gives way to the success line: focus moves to Done.
  const doneRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  // Opened from /maintenance the site starts empty (§23.1): nothing submits until one is picked.
  const picked = sites.find((s) => s.id === site) ?? null;
  const current = picked ?? sites[0]!;
  const durations = DURATIONS[kind];
  const dur = durations.some((d) => d.label === duration) ? duration : durations[durations.length - 1]!.label;
  const plan = planOf({
    kind,
    site: current,
    later,
    startDate,
    startTime,
    duration: dur,
    reason,
    now,
    isAdmin,
  });
  const isLater = kind === 'maintenance' && later;
  // Nothing picked yet (opened from /maintenance): no site's incident speaks for it (spec-check).
  const incident = picked ? current.openIncident : null;
  const rule = incident ? muteRule(incident) : null;
  // Already muted: alerts are held already, so the guard offers no second mute (verify).
  const mutedUntil =
    picked && current.mutedUntil && new Date(current.mutedUntil) > now ? new Date(current.mutedUntil) : null;
  const timeProblem = plan.problems.find((p) => p === 'starts_in_past' || p === 'ends_before_start');

  const switchKind = (v: string) => {
    setKind(v as WindowKind);
    setError(null);
  };
  const muteInstead = () => {
    setKind('mute');
    setDuration('4 h');
    setLater(false);
  };

  const submit = () =>
    start(async () => {
      setError(null);
      // "Now" is when Save is pressed, not when the dialog opened.
      const at = new Date();
      const p = planOf({
        kind,
        site: current,
        later,
        startDate,
        startTime,
        duration: dur,
        reason,
        now: at,
        isAdmin,
      });
      const r = await (
        kind === 'mute'
          ? muteSite({ siteId: current.id, endsAt: p.endsAt.toISOString(), reason })
          : scheduleMaintenance({
              siteId: current.id,
              startsAt: p.startsAt.toISOString(),
              endsAt: p.endsAt.toISOString(),
              reason,
            })
      ).catch(() => ({ ok: false as const, message: FAILED }));
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setDone(
        doneOf({
          kind,
          site: current,
          startsAt: p.startsAt,
          endsAt: p.endsAt,
          later: isLater,
          needsApproval: 'waiting' in r && typeof r.waiting === 'boolean' ? r.waiting : p.needsApproval,
          reason,
          viewer: viewerName,
          now: at,
        }),
      );
      router.refresh();
    });

  const owner = current.owner ? ` · owner ${current.owner}` : '';
  const title = kind === 'mute' ? 'Mute site' : 'Schedule maintenance';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      title={title}
      description={
        picked
          ? `${current.name} · ${formatTier(current.tier)}${owner}${isAdmin ? '' : ' · you’re a Responder'}`
          : 'Choose a site first — the list shows the sites you can act on'
      }
      footer={
        done ? (
          <>
            <Button variant="secondary" onClick={onClose} ref={doneRef}>
              Done
            </Button>
            {!fromPage && (
              <Button variant="primary" icon={<IconCalendar />} href="/maintenance">
                Open Maintenance &amp; mutes
              </Button>
            )}
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              // Phones: Mute instead is the one primary while the guard blocks (MMaintenance, §13).
              className={plan.blocked && picked && !mutedUntil ? 'max-md:hidden' : undefined}
              icon={kind === 'mute' ? <IconEyeOff /> : <IconCalendar />}
              disabled={plan.problems.length > 0 || !picked}
              loading={pending}
              onClick={submit}
            >
              {plan.submit}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <Alert tone="success" title={done.title}>
          {done.text}
        </Alert>
      ) : (
        <div className="flex flex-col gap-5">
          {(sites.length > 1 || !picked) && (
            <Select
              touchHeight
              label="Site"
              required
              options={[
                ...(picked ? [] : [{ value: '', label: 'Choose a site' }]),
                ...sites.map((s) => ({ value: s.id, label: `${s.name} · ${formatTier(s.tier)}` })),
              ]}
              value={picked?.id ?? ''}
              onChange={(e) => setSite(e.target.value)}
            />
          )}
          <span className="max-md:hidden">
            <RadioGroup touchHeight label="Type" options={TYPES} value={kind} onChange={switchKind} />
          </span>
          <span className="md:hidden">
            <SegmentedControl
              label="Type"
              options={PHONE_TYPES}
              value={kind}
              onChange={switchKind}
              fullWidth
            />
          </span>

          {plan.blocked && picked && (
            <Alert
              tone="danger"
              role="alert"
              title={guardTitle(current)}
              action={
                mutedUntil ? (
                  <span className="text-xs text-fg-secondary">{`Already muted until ${formatWhen(mutedUntil, now, { midSentence: true })} — new alerts are held.`}</span>
                ) : (
                  <span className="flex w-full flex-wrap items-center gap-2.5">
                    <span className="max-md:hidden">
                      <Button variant="secondary" size="sm" icon={<IconEyeOff />} onClick={muteInstead}>
                        Mute instead
                      </Button>
                    </span>
                    {/* phones: the only way on, full width (MMaintenance) */}
                    <span className="w-full md:hidden">
                      <Button variant="primary" icon={<IconEyeOff />} fullWidth onClick={muteInstead}>
                        Mute instead
                      </Button>
                    </span>
                    {rule && <span className="text-xs text-fg-secondary">{rule.title}</span>}
                  </span>
                )
              }
            >
              {mutedUntil ? GUARD_TEXT_MUTED : GUARD_TEXT}
            </Alert>
          )}

          {kind === 'maintenance' && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Start</span>
              <span className="flex flex-wrap items-center gap-4">
                <SegmentedControl
                  label="Start"
                  size="sm"
                  options={['Now', 'Later']}
                  value={later ? 'Later' : 'Now'}
                  onChange={(v) => setLater(v === 'Later')}
                />
                <span className="text-sm text-fg-secondary">
                  {later
                    ? 'Pick a date and time below'
                    : `Starts ${formatDay(now, { weekday: true })} ${formatTime(now)} (UTC+7)`}
                </span>
              </span>
            </div>
          )}
          {isLater && (
            <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
              <Select
                touchHeight
                label="Start date"
                options={days}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <TimePicker
                label="Start time"
                step={15}
                value={startTime}
                onChange={(v) => v && setStartTime(v)}
                error={timeProblem ? PROBLEM_WORDS[timeProblem] : undefined}
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Duration</span>
            <span className="flex flex-wrap items-center gap-4">
              <span className="max-md:hidden">
                <SegmentedControl
                  label="Duration"
                  size="sm"
                  options={durations.map((d) => d.label)}
                  value={dur}
                  onChange={setDuration}
                />
              </span>
              {/* phones: full width, as Type (MMaintenance) */}
              <span className="w-full md:hidden">
                <SegmentedControl
                  label="Duration"
                  options={durations.map((d) => d.label)}
                  value={dur}
                  onChange={setDuration}
                  fullWidth
                />
              </span>
              <span className="text-sm text-fg-secondary">{`Ends ${formatWhen(plan.endsAt, now, { midSentence: true })} (UTC+7)`}</span>
            </span>
          </div>

          {kind === 'mute' && incident && rule && (
            <Alert tone="warning" role="status" title={rule.title}>
              {rule.text}
            </Alert>
          )}
          {kind === 'mute' && incident && escalating(incident) && (
            <span className="md:hidden">
              <Button variant="secondary" icon={<IconCheck />} fullWidth href={`/incidents/${incident.id}`}>
                {`Acknowledge ${formatIncidentId(incident.number)} instead`}
              </Button>
            </span>
          )}

          <TextField
            touchHeight
            label="Reason"
            required
            placeholder={reasonPlaceholder(kind, !!incident)}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            hint={
              picked
                ? reasonHint(reason, plan.submit)
                : `Choose a site and type a reason to enable “${plan.submit}”.`
            }
          />
          {error && (
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          )}
          {plan.notice && picked && !error && (
            <Alert tone="warning" role="status">
              {plan.notice}
            </Alert>
          )}
          {/* §23.10: starting maintenance ends the site's running mute (D-036). */}
          {kind === 'maintenance' && mutedUntil && plan.startsAt < mutedUntil && (
            <p className="m-0 text-sm text-fg-secondary">Starting this window ends the mute.</p>
          )}

          {kind === 'maintenance' && plan.needsApproval && !plan.problems.includes('needs_approval_now') && (
            <Alert tone="warning" title="Needs an Admin’s approval">
              {`Windows over 24 h asked for by a Responder wait for an Admin. It starts only if approved before ${formatWhen(plan.startsAt, now, { midSentence: true })} — otherwise it doesn’t start. Follow it under Waiting for approval on Maintenance & mutes.`}
            </Alert>
          )}
          {kind === 'maintenance' &&
            isAdmin &&
            plan.endsAt.getTime() - plan.startsAt.getTime() > 24 * 3_600_000 && (
              <Alert tone="info" title="You’re an Admin — no approval needed">
                Windows over 24 h normally need an Admin’s approval. Yours starts as scheduled.
              </Alert>
            )}

          <div className="flex items-start gap-2.5 rounded-aura-md border border-border-default bg-bg-canvas p-3 text-sm">
            <span className="flex pt-0.5 text-fg-secondary">
              <IconInfo size="sm" />
            </span>
            <span>
              <span className="font-semibold">{EFFECT[kind].title}.</span> {EFFECT[kind].text}
            </span>
          </div>
          {kind === 'maintenance' && (
            <Switch
              label="Repeat on a schedule"
              description="Recurring windows arrive in Phase 2."
              disabled
            />
          )}
          <p className="m-0 text-xs text-fg-secondary md:hidden">{`Signed in as ${viewerEmail}`}</p>
        </div>
      )}
    </Dialog>
  );
}
