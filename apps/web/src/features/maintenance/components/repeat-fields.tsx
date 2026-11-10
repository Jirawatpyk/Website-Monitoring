'use client';

import { DatePicker, RadioGroup, SegmentedControl, Select, Tag, TimePicker } from '@jirawatpyk/aura-react';
import { IconRotateCcw } from '@jirawatpyk/aura-react/icons';
import { seriesTimeText } from '@dxt/shared';
import { useId } from 'react';
import {
  bangkokToday,
  fromMax,
  isoWeekdayOf,
  monthOptions,
  REPEATS,
  SERIES_DURATIONS,
  untilMax,
  WEEKDAYS,
  type Repeat,
  type RepeatPlan,
} from '../series-form';

export interface RepeatState {
  repeat: Repeat;
  from: string;
  time: string;
  duration: string;
  /** null until a chip is pressed: From's weekday is the default and follows From (§32.2). */
  days: number[] | null;
  monthMode: 'day' | 'nth';
  untilOn: string | null;
}

/** The weekdays in force: the ones picked, else From's (§32.2). */
export const daysOf = (s: RepeatState) => s.days ?? [isoWeekdayOf(s.from)];

/**
 * The Repeat control (§32.2): a labelled segmented control from md, a select on phones (§32.3). It sits
 * after Duration (Window length for a series) and stays in one place, so focus stays on it.
 */
export function RepeatControl({ value, onChange }: { value: Repeat; onChange: (r: Repeat) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium max-md:hidden" aria-hidden>
        Repeat
      </span>
      <span className="max-md:hidden">
        <SegmentedControl
          touchHeight
          label="Repeat"
          size="sm"
          options={REPEATS}
          value={value}
          onChange={(v) => onChange(v as Repeat)}
        />
      </span>
      <span className="md:hidden">
        <Select
          touchHeight
          label="Repeat"
          options={REPEATS}
          value={value}
          onChange={(e) => onChange(e.target.value as Repeat)}
        />
      </span>
    </div>
  );
}

/**
 * A repeating window's fields (boards Maintenance, MMaintenance; §32.2–3), in pieces the dialog lays out so
 * the DOM follows each board's order (reading and tab order, WCAG 1.3.2) and the one Repeat control never
 * moves (focus stays on it, WCAG 2.4.3): desktop Start · From | Time · Window length · Repeat · On · Ends on ·
 * summary; phones Window length · Repeat · From | Time · On · Ends on · summary.
 */
interface Piece {
  state: RepeatState;
  set: (patch: Partial<RepeatState>) => void;
  now: Date;
}

/** Desktop: "Start" and why a series can't start now. */
export function RepeatStart() {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Start</span>
      <span className="text-sm text-fg-secondary">
        A series can’t start now — its first window is at least 5 min away. Pick the first date and the time
        below.
      </span>
    </div>
  );
}

/** From | Time. */
export function RepeatWhen({ state, set, now }: Piece) {
  return (
    <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
      <DatePicker
        touchHeight
        label="From"
        required
        clearable={false}
        min={bangkokToday(now)}
        max={fromMax(now)}
        timeZone="Asia/Bangkok"
        weekStartsOn={1}
        value={state.from}
        onChange={(v) => v && set({ from: v })}
        hint="The first day the series may start — today to a year ahead (UTC+7)."
      />
      <TimePicker
        touchHeight
        clearable={false}
        label="Time"
        step={15}
        value={state.time}
        onChange={(v) => v && set({ time: v })}
      />
    </div>
  );
}

/** Window length, with each window's span. */
export function RepeatLength({ state, set }: Omit<Piece, 'now'>) {
  const minutes = SERIES_DURATIONS.find((d) => d.label === state.duration)?.minutes ?? 120;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium" aria-hidden>
        Window length
      </span>
      <span className="flex flex-wrap items-center gap-4">
        <span className="max-md:hidden">
          <SegmentedControl
            touchHeight
            label="Window length"
            size="sm"
            options={SERIES_DURATIONS.map((d) => d.label)}
            value={state.duration}
            onChange={(v) => set({ duration: v })}
          />
        </span>
        <span className="w-full md:hidden">
          <SegmentedControl
            touchHeight
            label="Window length"
            options={SERIES_DURATIONS.map((d) => d.label)}
            value={state.duration}
            onChange={(v) => set({ duration: v })}
            fullWidth
          />
        </span>
        <span className="text-sm text-fg-secondary">{`Each window lasts ${state.duration} (max 24 h) · ${seriesTimeText(state.time, minutes)}`}</span>
      </span>
    </div>
  );
}

/** On (chips or the monthly choice), Ends on and the summary. */
export function RepeatRest({ state, set, plan }: Omit<Piece, 'now'> & { plan: RepeatPlan }) {
  const hintId = useId();
  const days = daysOf(state);
  const toggle = (d: number) =>
    set({
      days: days.includes(d) ? days.filter((x) => x !== d) : [...days, d],
    });
  return (
    <>
      {state.repeat === 'weekly' ? (
        <div className="flex flex-col gap-2">
          <span id={`${hintId}-on`} className="text-sm font-medium">
            On
          </span>
          <div
            role="group"
            aria-labelledby={`${hintId}-on`}
            aria-describedby={hintId}
            className="flex flex-wrap gap-1.5"
          >
            {WEEKDAYS.map((w, i) => (
              <Tag key={w} touchHeight selected={days.includes(i + 1)} onClick={() => toggle(i + 1)}>
                {w}
              </Tag>
            ))}
          </div>
          <span id={hintId} className={`text-xs ${plan.daysError ? 'text-fg-danger' : 'text-fg-secondary'}`}>
            {plan.daysError ?? 'The first window is the first chosen day on or after From.'}
          </span>
        </div>
      ) : (
        <RadioGroup
          touchHeight
          label="On"
          options={monthOptions(state.from)}
          value={monthOptions(state.from).some((o) => o.value === state.monthMode) ? state.monthMode : 'day'}
          onChange={(v) => set({ monthMode: v as 'day' | 'nth' })}
        />
      )}
      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <DatePicker
          touchHeight
          optional
          label="Ends on"
          placeholder="No end date"
          min={state.from}
          max={untilMax(state.from)}
          timeZone="Asia/Bangkok"
          weekStartsOn={1}
          value={state.untilOn}
          onChange={(v) => set({ untilOn: v })}
          hint={
            state.untilOn
              ? 'Last day a window can start. Clear it (×) for no end date.'
              : 'No end date — it repeats until cancelled. Up to two years after From.'
          }
          error={plan.untilError ?? undefined}
        />
      </div>
      <div className="flex items-start gap-2.5 rounded-aura-md border border-border-default bg-bg-canvas p-3 text-sm">
        <span className="flex pt-0.5 text-fg-secondary">
          <IconRotateCcw size="sm" />
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">{plan.summary}</span>
          <span className="text-fg-secondary">
            Each window is an ordinary maintenance window, created 14 days ahead. One that overlaps another
            window on this site is skipped and noted on the series; one that would start while the site is
            DOWN doesn’t start.
          </span>
        </span>
      </div>
    </>
  );
}
