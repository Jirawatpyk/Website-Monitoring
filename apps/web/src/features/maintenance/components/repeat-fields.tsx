'use client';

import { DatePicker, RadioGroup, SegmentedControl, Select, TimePicker } from '@jirawatpyk/aura-react';
import { IconRotateCcw } from '@jirawatpyk/aura-react/icons';
import {
  bangkokToday,
  fromMax,
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
  days: number[];
  monthMode: 'day' | 'nth';
  untilOn: string | null;
}

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring';

/** The Repeat control itself (§32.2): a segmented control on desktop, a select on phones (§32.3). */
export function RepeatControl({ value, onChange }: { value: Repeat; onChange: (r: Repeat) => void }) {
  return (
    <>
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
    </>
  );
}

/**
 * A repeating window's fields (boards Maintenance, MMaintenance; §32.2–3): Window length, From, Time, the
 * weekday chips or the monthly choice, Ends on, and the summary box.
 */
export function RepeatFields({
  state,
  set,
  plan,
  now,
}: {
  state: RepeatState;
  set: (patch: Partial<RepeatState>) => void;
  plan: RepeatPlan;
  now: Date;
}) {
  const toggle = (d: number) =>
    set({ days: state.days.includes(d) ? state.days.filter((x) => x !== d) : [...state.days, d] });
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Window length</span>
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
        <span className="md:hidden">
          <SegmentedControl
            touchHeight
            label="Window length"
            options={SERIES_DURATIONS.map((d) => d.label)}
            value={state.duration}
            onChange={(v) => set({ duration: v })}
            fullWidth
          />
        </span>
      </div>
      <p className="m-0 text-sm text-fg-secondary">
        A series can’t start now — its first window is at least 5 min away.
      </p>
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
        />
        <TimePicker label="Time" step={15} value={state.time} onChange={(v) => v && set({ time: v })} />
      </div>
      {state.repeat === 'weekly' ? (
        <div className="flex flex-col gap-2">
          <span id="repeat-on" className="text-sm font-medium">
            On
          </span>
          <div role="group" aria-labelledby="repeat-on" className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((w, i) => {
              const on = state.days.includes(i + 1);
              return (
                <button
                  key={w}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(i + 1)}
                  className={`min-h-11 min-w-11 cursor-pointer rounded-aura-full border px-2.5 text-sm font-medium ${FOCUS} ${
                    on
                      ? 'border-fg-primary bg-fg-primary text-bg-surface'
                      : 'border-border-control bg-bg-surface text-fg-primary hover:bg-bg-surface-hover'
                  }`}
                >
                  {w}
                </button>
              );
            })}
          </div>
          <span className={`text-xs ${plan.daysError ? 'text-fg-danger' : 'text-fg-secondary'}`}>
            {plan.daysError ?? 'From the first chosen day on or after From.'}
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
      <DatePicker
        touchHeight
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
    </div>
  );
}
