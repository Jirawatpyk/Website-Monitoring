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
import { IconCheck, IconInfo, IconPencil, IconPlus, IconTrash2 } from '@jirawatpyk/aura-react/icons';
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
    setOpened((n) => n + 1);
    setOpen(o);
  };
  const finish = (text: string) => {
    setOpen(null);
    setDone((d) => ({ text, n: (d?.n ?? 0) + 1 }));
    router.refresh();
  };

  return (
    <section id="holidays" className="flex scroll-mt-4 flex-col gap-3" aria-labelledby="holidays-h">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="holidays-h" className={SECTION_HEADING}>
            <span className="md:hidden">COMPANY HOLIDAYS</span>
            <span className="hidden md:inline">Company holidays</span>
          </h2>
          <span className="text-sm text-fg-secondary">
            On these days Tier 2–3 timers wait for the next working day and Tier 1 is with the person on call
            all day. Changes are logged.
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

      <div className="overflow-hidden rounded-aura-lg border border-border-default bg-bg-surface">
        {years.map((y) => (
          <div key={y.year} className="flex flex-col">
            <h3 className="m-0 border-t border-border-subtle bg-bg-subtle px-4 py-2 text-xs font-semibold text-fg-secondary first:border-t-0">
              {y.head}
            </h3>
            <ul className="m-0 flex list-none flex-col p-0" aria-label={`Holidays ${y.year}`}>
              {y.rows.map((r) => (
                <li
                  key={r.id}
                  className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-border-subtle py-1.5 pr-2 pl-4 text-sm md:grid-cols-[calc(var(--spacing)*36)_minmax(0,1fr)_calc(var(--spacing)*40)_auto]"
                >
                  <span className="font-medium tabular-nums">{r.date}</span>
                  <span className="col-span-2 row-start-2 flex min-w-0 flex-col md:col-span-1 md:row-start-auto">
                    <span>{r.name}</span>
                    {r.sub && <span className="text-xs text-fg-secondary">{r.sub}</span>}
                  </span>
                  <span className="col-start-2 row-start-1 justify-self-end md:col-start-auto md:row-start-auto md:justify-self-start">
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
                  No holidays left in {y.year}.
                </li>
              )}
            </ul>
            {y.note && (
              <p className="m-0 flex gap-2 border-t border-border-subtle px-4 py-3 text-xs leading-normal text-fg-secondary">
                <span className="flex pt-px" aria-hidden>
                  <IconInfo size="sm" />
                </span>
                {y.note}
              </p>
            )}
          </div>
        ))}
      </div>
      <span className="text-xs text-fg-secondary">
        <span className="md:hidden">Holidays change on a larger screen. </span>
        Past days aren’t listed and can’t be added or changed. The audit log keeps every add, rename and
        remove.
      </span>
      <span
        ref={statusRef}
        role="status"
        tabIndex={-1}
        className={`self-start text-sm text-fg-positive empty:hidden ${FOCUS_TARGET}`}
      >
        {done?.text}
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
      if (r.ok) onDone(`Added ${formatDay(dayDate(day), { weekday: true })} · ${n} · logged`);
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
          label="Kind"
          options={HOLIDAY_KINDS.map((k) => ({ value: k.value, label: k.label }))}
          value={kind}
          onChange={(e) => setKind(e.target.value === 'public' ? 'public' : 'company')}
        />
        <TextField
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
      if (r.ok) onDone(`Renamed ${row.date} to ${n} · logged`);
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
      if (r.ok) onDone(`Removed ${row.date} · ${row.name} · logged`);
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
        <Alert tone="warning" title={`What changes on ${row.date}`}>
          {effect.body}
        </Alert>
        <Failure text={failure} />
      </div>
    </Dialog>
  );
}
