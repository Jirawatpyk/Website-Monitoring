'use client';

import type { WindowKind } from '@dxt/engine';
import { formatDay, formatIncidentId, formatTier, formatTime } from '@dxt/shared';
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
import { useMemo, useState, useTransition } from 'react';
import { muteSite, scheduleMaintenance } from '../actions';
import {
  DURATIONS,
  EFFECT,
  GUARD_TEXT,
  PROBLEM_WORDS,
  doneOf,
  escalating,
  guardTitle,
  muteRule,
  planOf,
  reasonHint,
  reasonPlaceholder,
  startDays,
  whenText,
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
}) {
  const router = useRouter();
  const [now] = useState(() => new Date());
  const days = useMemo(() => startDays(now), [now]);
  const [site, setSite] = useState(siteId);
  const [kind, setKind] = useState<WindowKind>(initialKind);
  const [later, setLater] = useState(false);
  const [startDate, setStartDate] = useState(days[1]!.value);
  const [startTime, setStartTime] = useState('22:00');
  const [duration, setDuration] = useState('4 h');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ title: string; text: string } | null>(null);
  const [pending, start] = useTransition();

  const current = sites.find((s) => s.id === site) ?? sites[0]!;
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
  const incident = current.openIncident;
  const rule = incident ? muteRule(incident) : null;
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
          needsApproval: p.needsApproval,
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
      autoFocus={false}
      title={title}
      description={`${current.name} · ${formatTier(current.tier)}${owner}`}
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={kind === 'mute' ? <IconEyeOff /> : <IconCalendar />}
              disabled={plan.problems.length > 0}
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
          {sites.length > 1 && (
            <Select
              touchHeight
              label="Site"
              required
              options={sites.map((s) => ({ value: s.id, label: `${s.name} · ${formatTier(s.tier)}` }))}
              value={current.id}
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

          {plan.blocked && (
            <Alert
              tone="danger"
              role="alert"
              title={guardTitle(current)}
              action={
                <span className="flex flex-wrap items-center gap-2.5">
                  <Button variant="secondary" size="sm" icon={<IconEyeOff />} onClick={muteInstead}>
                    Mute instead
                  </Button>
                  {rule && <span className="text-xs text-fg-secondary">{rule.title}</span>}
                </span>
              }
            >
              {GUARD_TEXT}
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
              <SegmentedControl
                label="Duration"
                size="sm"
                options={durations.map((d) => d.label)}
                value={dur}
                onChange={setDuration}
              />
              <span className="text-sm text-fg-secondary">{`Ends ${whenText(plan.endsAt, now)} (UTC+7)`}</span>
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
            hint={reasonHint(reason, plan.submit)}
            error={error ?? undefined}
          />

          {kind === 'maintenance' && plan.needsApproval && (
            <Alert tone="info" title="Waits for an Admin’s approval">
              {`Windows over 24 h need an Admin’s approval. It starts only if an Admin approves it before ${whenText(plan.startsAt, now)}; until then alerts carry on.`}
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
