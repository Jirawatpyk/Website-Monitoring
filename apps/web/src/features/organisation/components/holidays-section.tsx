'use client';

import {
  Alert,
  Badge,
  Button,
  DatePicker,
  Dialog,
  IconButton,
  Select,
  TextField,
} from '@jirawatpyk/aura-react';
import { IconCheck, IconEye, IconInfo, IconPencil, IconPlus, IconTrash2 } from '@jirawatpyk/aura-react/icons';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { FOCUS_TARGET } from '@/components/focus-target';
import { SECTION_HEADING } from '@/features/settings';
import { addHoliday, removeHoliday, renameHoliday } from '../actions';
import {
  bangkokToday,
  dayDate,
  HOLIDAY_KINDS,
  HOLIDAY_NAME_MAX,
  holidayYears,
  lastHolidayDay,
  removeEffect,
  takenLine,
  type Holiday,
  type HolidayRow,
  type Hours,
} from '../holidays';
import { formatDay } from '@dxt/shared';

type Open =
  { kind: 'add' } | { kind: 'rename'; row: HolidayRow } | { kind: 'remove'; row: HolidayRow } | null;

const longDate = (day: string) => formatDay(dayDate(day), { weekday: true, year: true });

/**
 * Company holidays (board OrganisationLists, spec §41): this year from today and next year, one change
 * at a time in a dialog, no note — the audit log has who and when. Editing from md; view only below.
 */
export function HolidaysSection({ holidays, hours, now }: { holidays: Holiday[]; hours: Hours; now: Date }) {
  const router = useRouter();
  const years = holidayYears(holidays, hours, now);
  // The last dialog opened stays mounted (closed) so focus goes back to the button that opened it;
  // each opening starts a fresh one (the counter keys it).
  const [last, setLast] = useState<Open>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [opened, setOpened] = useState(0);
  const setOpen = (o: Open) => (o ? (setLast(o), setIsOpen(true)) : setIsOpen(false));
  const [done, setDone] = useState<{ text: string; n: number } | null>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  // After a change the dialog (and maybe the row) is gone: focus the result line once it renders.
  useEffect(() => {
    if (done) statusRef.current?.focus();
  }, [done]);

  const show = (o: Exclude<Open, null>) => {
    setDone(null);
    setOpened((n) => n + 1);
    setOpen(o);
  };
  const finish = (text: string) => {
    setOpen(null);
    setDone((d) => ({ text, n: (d?.n ?? 0) + 1 }));
    router.refresh();
  };

  return (
    <section
      id="holidays"
      className="flex scroll-mt-18 lg:scroll-mt-4 flex-col gap-3"
      aria-labelledby="holidays-h"
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="holidays-h" className={SECTION_HEADING}>
            <span className="md:hidden">COMPANY HOLIDAYS</span>
            <span className="hidden md:inline">Company holidays</span>
          </h2>
          <span className="hidden text-sm text-fg-secondary md:inline">
            On these days Tier 2–3 timers wait for the next working day and Tier 1 is with the person on call
            all day. Changes are logged.
          </span>
          <span className="text-sm text-fg-secondary md:hidden">
            Tier 2–3 timers wait and Tier 1 is with the person on call all day.
          </span>
        </div>
        <div className="hidden md:flex">
          <Button
            variant="secondary"
            size="sm"
            touchHeight
            icon={<IconPlus />}
            onClick={() => show({ kind: 'add' })}
          >
            Add holiday
          </Button>
        </div>
      </div>

      <span
        ref={statusRef}
        role="status"
        tabIndex={-1}
        className={`self-start text-sm text-fg-positive empty:hidden ${FOCUS_TARGET}`}
      >
        {done?.text}
      </span>

      {years.map((y) => (
        <div
          key={y.year}
          className="flex flex-col overflow-hidden rounded-aura-lg border border-border-default bg-bg-surface"
        >
          <h3 className="m-0 bg-bg-canvas px-4 py-2.5 font-mono text-xs font-normal text-fg-secondary md:px-5">
            {y.head}
          </h3>
          <ul className="m-0 flex list-none flex-col p-0" aria-label={`Holidays ${y.year}`}>
            {y.rows.map((r) => (
              <li
                key={r.id}
                className="grid min-h-12 grid-cols-[calc(var(--spacing)*21)_minmax(0,1fr)] items-start gap-3 border-t border-border-subtle px-4 py-2.5 text-sm md:grid-cols-[calc(var(--spacing)*36)_minmax(0,1fr)_calc(var(--spacing)*40)_auto] md:items-center md:py-1 md:pr-2 md:pl-5"
              >
                <span className="font-medium tabular-nums">{r.date}</span>
                <span className="flex min-w-0 flex-col">
                  <span>{r.name}</span>
                  {/* Phones: the kind as a line, company days only (MOrganisationLists). */}
                  {r.kind === 'company' && (
                    <span className="text-xs text-fg-secondary md:hidden">{r.kindLabel}</span>
                  )}
                  {r.sub && <span className="text-xs text-fg-secondary">{r.sub}</span>}
                </span>
                <span className="hidden md:inline">
                  <Badge tone="neutral" variant={r.kind === 'company' ? 'soft' : 'outline'}>
                    {r.kindLabel}
                  </Badge>
                </span>
                <span className="hidden gap-1 md:flex">
                  <IconButton
                    icon={<IconPencil />}
                    label={`Rename ${r.name}, ${r.date}`}
                    size="sm"
                    touchHeight
                    onClick={() => show({ kind: 'rename', row: r })}
                  />
                  <IconButton
                    icon={<IconTrash2 />}
                    label={`Remove ${r.name}, ${r.date}`}
                    size="sm"
                    touchHeight
                    onClick={() => show({ kind: 'remove', row: r })}
                  />
                </span>
              </li>
            ))}
            {y.rows.length === 0 && (
              <li className="border-t border-border-subtle px-4 py-3 text-sm text-fg-secondary">
                {y.year === years[0]?.year ? 'No holidays left this year.' : `No holidays in ${y.year} yet.`}
              </li>
            )}
          </ul>
          {y.note && (
            <p className="m-0 flex gap-2 border-t border-border-subtle px-4 py-3 text-xs leading-normal text-fg-secondary md:px-5">
              <span className="hidden pt-px md:flex" aria-hidden>
                <IconInfo size="sm" />
              </span>
              {y.note}
            </p>
          )}
        </div>
      ))}
      <span className="hidden text-xs text-fg-secondary md:inline">
        Past days aren’t listed and can’t be added or changed. The audit log keeps every add, rename and
        remove.
      </span>
      <span className="flex items-center gap-2 text-xs text-fg-secondary md:hidden">
        <span className="flex" aria-hidden>
          <IconEye size="sm" />
        </span>
        Holidays change on a larger screen.
      </span>

      {last?.kind === 'add' && (
        <AddDialog
          key={opened}
          open={isOpen}
          holidays={holidays}
          now={now}
          onClose={() => setOpen(null)}
          onDone={finish}
        />
      )}
      {last?.kind === 'rename' && (
        <RenameDialog
          key={opened}
          open={isOpen}
          row={last.row}
          onClose={() => setOpen(null)}
          onDone={finish}
        />
      )}
      {last?.kind === 'remove' && (
        <RemoveDialog
          key={opened}
          open={isOpen}
          row={last.row}
          hours={hours}
          onClose={() => setOpen(null)}
          onDone={finish}
        />
      )}
    </section>
  );
}

function Failure({ text }: { text: string | null }) {
  return text ? (
    <Alert tone="danger" title="Not saved" role="alert">
      {text}
    </Alert>
  ) : null;
}

function AddDialog({
  open,
  holidays,
  now,
  onClose,
  onDone,
}: {
  open: boolean;
  holidays: Holiday[];
  now: Date;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const today = bangkokToday(now);
  const [day, setDay] = useState<string | null>(today);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Holiday['kind']>('company');
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const taken = day ? holidays.find((h) => h.day === day) : undefined;
  const dayError = !day
    ? tried
      ? 'Pick a day.'
      : null
    : day < today
      ? 'Pick today or a later day — past days can’t be added.'
      : taken
        ? takenLine(taken.day, taken.name)
        : null;
  const n = name.trim();
  const nameError =
    tried && !n ? 'Give the day a name.' : n.length > HOLIDAY_NAME_MAX ? 'Up to 100 characters.' : null;

  const save = () => {
    setTried(true);
    if (!day || dayError || !n || n.length > HOLIDAY_NAME_MAX) return;
    setFailure(null);
    start(async () => {
      const r = await addHoliday({ day, name: n, kind });
      if (r.ok)
        onDone(
          `Added ${formatDay(dayDate(day), { weekday: true })} “${n}” · logged · timers treat it as a day off within a minute`,
        );
      else setFailure(r.message);
    });
  };

  return (
    <Dialog
      open={open}
      size="sm"
      onClose={() => !pending && onClose()}
      title="Add a holiday"
      description="On this day Tier 2–3 timers wait for the next working day and Tier 1 is with the person on call all day."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" icon={<IconPlus />} loading={pending} onClick={save}>
            Add holiday
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <DatePicker
          touchHeight
          label="Date"
          required
          clearable={false}
          min={today}
          max={lastHolidayDay(now)}
          today={today}
          timeZone="Asia/Bangkok"
          weekStartsOn={1}
          value={day}
          onChange={setDay}
          error={dayError ?? undefined}
          hint="Today or later — past days can’t be added."
        />
        <Select
          touchHeight
          label="Kind"
          options={HOLIDAY_KINDS.map((k) => ({ value: k.value, label: k.label }))}
          value={kind}
          onChange={(e) => setKind(e.target.value === 'public' ? 'public' : 'company')}
        />
        <TextField
          touchHeight
          label="Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Company outing"
          error={nameError ?? undefined}
          hint={`${n.length} / ${HOLIDAY_NAME_MAX}`}
        />
        <Failure text={failure} />
      </div>
    </Dialog>
  );
}

function RenameDialog({
  open,
  row,
  onClose,
  onDone,
}: {
  open: boolean;
  row: HolidayRow;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [name, setName] = useState(row.name);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const n = name.trim();
  const nameError = !n
    ? 'Give the day a name.'
    : n.length > HOLIDAY_NAME_MAX
      ? 'Up to 100 characters.'
      : null;
  const save = () => {
    if (nameError) return;
    if (n === row.name) return onClose();
    setFailure(null);
    start(async () => {
      const r = await renameHoliday({ id: row.id, name: n });
      if (r.ok) onDone(`Renamed ${row.date} to “${n}” · logged`);
      else setFailure(r.message);
    });
  };
  return (
    <Dialog
      open={open}
      size="sm"
      onClose={() => !pending && onClose()}
      title="Rename holiday"
      description={`${longDate(row.day)} · the date can’t change — remove it and add a new one instead.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" icon={<IconCheck />} loading={pending} onClick={save}>
            Save name
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <TextField
          touchHeight
          label="Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={nameError ?? undefined}
          hint={`${n.length} / ${HOLIDAY_NAME_MAX}`}
        />
        <Failure text={failure} />
      </div>
    </Dialog>
  );
}

function RemoveDialog({
  open,
  row,
  hours,
  onClose,
  onDone,
}: {
  open: boolean;
  row: HolidayRow;
  hours: Hours;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const effect = removeEffect(row, hours);
  const remove = () => {
    setFailure(null);
    start(async () => {
      const r = await removeHoliday(row.id);
      if (r.ok) onDone(`Removed ${row.date} · ${effect.result} · logged`);
      else setFailure(r.message);
    });
  };
  return (
    <Dialog
      open={open}
      size="sm"
      onClose={() => !pending && onClose()}
      title={`Remove “${row.name}”?`}
      description={effect.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" icon={<IconTrash2 />} loading={pending} onClick={remove}>
            Remove holiday
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Alert
          tone={effect.offDay ? 'info' : 'warning'}
          title={effect.offDay ? `Nothing changes on ${row.date}` : `What changes on ${row.date}`}
        >
          {effect.body}
        </Alert>
        <Failure text={failure} />
      </div>
    </Dialog>
  );
}
