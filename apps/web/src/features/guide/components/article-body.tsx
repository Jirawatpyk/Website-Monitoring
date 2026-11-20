import type { ReactElement, ReactNode } from 'react';
import { Alert, Badge, Button, Table, TBody, Td, Th, THead, Tr } from '@jirawatpyk/aura-react';
import {
  IconArrowRight,
  IconArrowUpRight,
  IconBell,
  IconCalendar,
  IconChartColumn,
  IconCheck,
  IconCircleAlert,
  IconCircleCheck,
  IconEyeOff,
  IconFileText,
  IconLayoutDashboard,
  IconLock,
  IconMail,
  IconMonitor,
  IconPencil,
  IconRotateCcw,
  IconSettings,
  IconUser,
  IconUsers,
} from '@jirawatpyk/aura-react/icons';
import { MATRIX_ROLES, ROLE_LABELS, ROLE_MATRIX } from '@dxt/shared';
import { RoleMark } from '@/components/role-mark';
import { RoleMatrixPicker } from '@/components/role-matrix';
import { GLYPH_LEGEND, GLYPHS } from '@/components/site-cells';
import { SeverityBadge, SiteStatusBadge, WorkflowBadge } from '@/components/status-badges';
import type { Block, GuideIcon, RelatedLink, Step, Topic } from '../content';

/** The icon of a topic or a related screen. */
export const GUIDE_ICONS: Record<GuideIcon, ReactElement> = {
  lock: <IconLock />,
  bell: <IconBell />,
  'circle-check': <IconCircleCheck />,
  'circle-alert': <IconCircleAlert />,
  mail: <IconMail />,
  pencil: <IconPencil />,
  monitor: <IconMonitor />,
  'eye-off': <IconEyeOff />,
  users: <IconUsers />,
  'chart-column': <IconChartColumn />,
  settings: <IconSettings />,
  'arrow-up-right': <IconArrowUpRight />,
  user: <IconUser />,
  calendar: <IconCalendar />,
  'file-text': <IconFileText />,
  'layout-dashboard': <IconLayoutDashboard />,
};

const BOX = 'flex flex-col rounded-aura-md border border-border-default';
const CAPS = 'font-mono text-xs text-fg-tertiary';
const SUB = 'text-sm leading-normal text-fg-secondary';

function Num({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className="flex size-7 shrink-0 items-center justify-center rounded-aura-full bg-bg-surface-strong font-mono text-xs text-fg-inverted"
    >
      {n}
    </span>
  );
}

function Arrow() {
  return (
    <span aria-hidden className="flex text-fg-tertiary">
      <IconArrowRight size="sm" />
    </span>
  );
}

/** Badges in a row with arrows between them (Unacked → Escalated → Acknowledged; the lifecycle). */
function Flow({ states }: { states: Step['flow'] & {} }) {
  return (
    <span className="flex flex-wrap items-center gap-2 leading-none">
      {states.map((s, i) => (
        <span key={s} className="flex items-center gap-2">
          {i > 0 && <Arrow />}
          <WorkflowBadge state={s} level={s === 'escalated' ? 1 : undefined} />
        </span>
      ))}
    </span>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-aura-sm border border-border-default bg-bg-canvas px-3 py-2 font-mono text-xs leading-normal break-words">
      {children}
    </div>
  );
}

function StepItem({ step, n }: { step: Step; n: number }) {
  return (
    <div className="flex gap-3.5">
      <Num n={n} />
      <div className="flex min-w-0 grow flex-col gap-2 leading-normal">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{step.title}</span>
          {step.badge && <WorkflowBadge state={step.badge} />}
        </span>
        <span className={SUB}>{step.text}</span>
        {step.flow && <Flow states={step.flow} />}
        {step.mono && !step.gates && <Mono>{step.mono}</Mono>}
        {step.toast && (
          // A picture of the held-action toast, not a live one (Guide board): read as text, not a button.
          <figure className="m-0 flex w-full max-w-130 items-center gap-3.5 rounded-aura-lg bg-bg-surface-strong py-3 pr-3 pl-4.5 text-fg-inverted">
            <figcaption className="sr-only">Example of the undo bar:</figcaption>
            <IconCheck size="sm" />
            <span className="flex grow flex-col text-sm leading-snug">
              <span className="font-semibold">{step.toast.title}</span>
              <span className="text-xs">{step.toast.line}</span>
            </span>
            <span className="flex h-9 shrink-0 items-center gap-1.5 rounded-aura-full border border-current px-4 text-sm font-medium">
              <IconRotateCcw size="sm" />
              {step.toast.undo}
            </span>
          </figure>
        )}
        {step.gates && (
          <>
            <div className={`${BOX} px-4 py-1`}>
              {step.gates.map((g, i) => (
                <div
                  key={g.t}
                  className={`flex gap-2.5 py-2 text-sm leading-snug ${i < step.gates!.length - 1 ? 'border-b border-border-subtle' : ''}`}
                >
                  <span className="flex pt-px text-fg-positive">
                    <IconCircleCheck size="sm" />
                  </span>
                  <span className="flex flex-col">
                    <span className="font-medium">{g.t}</span>
                    <span className="text-xs text-fg-secondary">{g.d}</span>
                  </span>
                </div>
              ))}
            </div>
            {step.mono && <Mono>{step.mono}</Mono>}
          </>
        )}
        {step.after && <span className="text-xs text-fg-secondary">{step.after}</span>}
      </div>
    </div>
  );
}

function Rows<T>({ rows, render }: { rows: readonly T[]; render: (row: T, last: boolean) => ReactNode }) {
  return <>{rows.map((r, i) => render(r, i === rows.length - 1))}</>;
}

const line = (last: boolean) => (last ? '' : 'border-b border-border-subtle');

function BlockView({ block, phone }: { block: Block; phone: boolean }) {
  switch (block.kind) {
    case 'bullets':
      return (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {block.items.map((b) => (
            <li key={b.lead} className="flex gap-3 leading-relaxed">
              <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-aura-full bg-fg-tertiary" />
              <span>
                <span className="font-semibold">{b.lead}</span>{' '}
                <span className="text-fg-secondary">{b.text}</span>
              </span>
            </li>
          ))}
        </ul>
      );
    case 'steps':
      return (
        <ol className="m-0 flex list-none flex-col gap-5 p-0">
          {block.items.map((s, i) => (
            <li key={s.title}>
              <StepItem step={s} n={i + 1} />
            </li>
          ))}
        </ol>
      );
    case 'checklist':
      return (
        <div className="flex flex-col gap-2.5 rounded-aura-md border border-dashed border-border-default px-4 py-3.5">
          <span className={CAPS}>{block.title}</span>
          {block.items.map((c) => (
            <span key={c} className="flex items-center gap-2.5 text-sm font-medium">
              <span className="flex text-fg-positive">
                <IconCircleCheck size="sm" />
              </span>
              {c}
            </span>
          ))}
        </div>
      );
    case 'callout':
      return (
        <Alert tone={block.callout.tone} title={block.callout.title} role="note">
          {block.callout.text}
        </Alert>
      );
    case 'ladder':
      return (
        <div className="flex flex-col gap-3">
          <h3 className="m-0 text-base font-semibold">Who gets it if nobody acknowledges</h3>
          <div className={`${BOX} px-4 py-1`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle py-2">
              <span className="text-sm font-semibold">{block.title}</span>
              <span className="text-xs text-fg-secondary">{block.note}</span>
            </div>
            <Rows
              rows={block.rows}
              render={(l, last) => (
                <div
                  key={l.level}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-xs leading-snug ${line(last)}`}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-aura-full bg-status-neutral-bg font-mono text-xs text-status-neutral-fg">
                    {l.level}
                  </span>
                  <span className="w-14 shrink-0 text-sm font-semibold">{l.when}</span>
                  <span className="min-w-0 grow basis-48 text-fg-secondary">{l.who}</span>
                  <span
                    className={`shrink-0 max-md:pl-10 md:w-48 md:text-right md:whitespace-nowrap ${l.fyi ? 'text-alert-warning-fg' : 'text-fg-secondary'}`}
                  >
                    {l.ack}
                  </span>
                </div>
              )}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {block.cards.map((c) => (
              <div
                key={c.title}
                className={`${BOX} gap-1.5 px-4 py-3.5 text-xs leading-normal text-fg-secondary`}
              >
                <span className="text-sm font-semibold text-fg-primary">{c.title}</span>
                <span>{c.text}</span>
              </div>
            ))}
          </div>
        </div>
      );
    case 'lifecycle':
      return (
        <div className="flex flex-col gap-3 rounded-aura-md border border-dashed border-border-default p-4">
          <span className={CAPS}>THE LIFECYCLE · DOWN AND PROBLEM</span>
          <Flow states={block.states} />
          <span className="text-xs leading-normal text-fg-secondary">{block.note}</span>
        </div>
      );
    case 'compare': {
      const cols =
        'grid grid-cols-[calc(var(--spacing)*33)_1fr_1fr] gap-4 px-4 py-2.5 max-md:grid-cols-[calc(var(--spacing)*22)_1fr_1fr] max-md:gap-2';
      return (
        <div role="table" aria-label="Mute and maintenance compared" className={`${BOX} overflow-hidden`}>
          <div role="row" className={`${cols} items-center border-b border-border-default bg-bg-canvas`}>
            <span role="columnheader" />
            <span role="columnheader" className="flex items-center gap-2 font-semibold">
              <IconEyeOff size="sm" />
              Mute
            </span>
            <span role="columnheader" className="flex items-center gap-2 font-semibold">
              <IconCalendar size="sm" />
              Maintenance
            </span>
          </div>
          <div role="row" className={`${cols} items-center border-b border-border-subtle text-sm`}>
            <span role="rowheader" className="text-fg-secondary">
              What you see
            </span>
            <span role="cell" className="flex flex-wrap items-center gap-1.5 leading-none">
              <SiteStatusBadge status="ok" />
              <Badge tone="neutral" variant="outline" icon={<IconEyeOff />}>
                Muted · until 14:30
              </Badge>
            </span>
            <span role="cell" className="flex leading-none">
              <SiteStatusBadge status="maintenance" />
            </span>
          </div>
          {block.rows.map((m) => (
            <div
              key={m.k}
              role="row"
              className={`${cols} border-b border-border-subtle text-sm leading-snug last:border-b-0 max-md:text-xs`}
            >
              <span role="rowheader" className="text-fg-secondary">
                {m.k}
              </span>
              <span role="cell">{m.mute}</span>
              <span role="cell">{m.maint}</span>
            </div>
          ))}
        </div>
      );
    }
    case 'siteStates':
      return (
        <div className="flex flex-col gap-2.5">
          <h3 className="m-0 text-base font-semibold">Site status — how the site is right now</h3>
          <div className={`${BOX} px-4 py-0.5`}>
            <Rows
              rows={block.rows}
              render={(s, last) => (
                <div
                  key={`${s.status}${s.muted ? '-muted' : ''}`}
                  className={`grid grid-cols-1 items-center gap-2 py-2.5 md:grid-cols-[calc(var(--spacing)*55)_1fr] md:gap-4 ${line(last)}`}
                >
                  <span className="flex flex-wrap items-center gap-1.5 leading-none">
                    <SiteStatusBadge status={s.status} />
                    {s.muted && (
                      <Badge tone="neutral" variant="outline" icon={<IconEyeOff />}>
                        Muted · until 14:30
                      </Badge>
                    )}
                  </span>
                  <span className={SUB}>{s.text}</span>
                </div>
              )}
            />
          </div>
        </div>
      );
    case 'incidentStates':
      return (
        <div className="flex flex-col gap-2.5">
          <h3 className="m-0 text-base font-semibold">Incident state — where the response is</h3>
          <div className="grid grid-cols-1 gap-x-6 rounded-aura-md border border-border-default px-4 py-0.5 md:grid-cols-2">
            {block.rows.map((s) => (
              <div
                key={s.state}
                className="flex flex-col gap-1.5 border-b border-border-subtle py-2.5 last:border-b-0 md:nth-last-2:border-b-0"
              >
                <span className="flex leading-none">
                  <WorkflowBadge state={s.state} level={s.state === 'escalated' ? 1 : undefined} />
                </span>
                <span className="text-xs leading-normal text-fg-secondary">{s.text}</span>
              </div>
            ))}
          </div>
          <span className="flex flex-wrap items-center gap-2 text-xs leading-normal text-fg-secondary">
            In lists of past or needs-action items the severity is shown outlined:
            <SeverityBadge severity="down" recovered />
          </span>
        </div>
      );
    case 'glyphs':
      return (
        <div className="flex flex-col gap-2.5">
          <h3 className="m-0 text-base font-semibold">Location results — BKK · SIN · TYO</h3>
          <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-aura-md border border-border-default px-4 py-3 text-sm">
            {GLYPH_LEGEND.map((g) => (
              <span key={g} className="flex items-center gap-1.5">
                <span className={`flex ${GLYPHS[g].tone}`} aria-hidden>
                  {GLYPHS[g].icon}
                </span>
                {GLYPHS[g].label}
              </span>
            ))}
          </div>
        </div>
      );
    case 'matrix':
      return phone ? <RoleMatrixPicker rows={GUIDE_MATRIX} roles={STAFF} /> : <Matrix />;
  }
}

/** Rows for features not built yet (S20, S22) stay on Settings › Users but not in the guide (D-070 item 3). */
const NOT_BUILT = new Set([
  'Download uptime reports',
  'Send client reports / edit AM note',
  'Approve incident review',
]);
const GUIDE_MATRIX = ROLE_MATRIX.filter((r) => !NOT_BUILT.has(r.label));
const STAFF = MATRIX_ROLES.filter((r) => r !== 'client');
const COL: Record<(typeof STAFF)[number], string> = {
  admin: 'w-18',
  responder: 'w-50',
  stakeholder: 'w-28 whitespace-nowrap',
  viewer: 'w-18',
};

/** The role matrix, the client column left out (Phase 3): Settings › Users' rows for what is built. */
function Matrix() {
  return (
    <Table aria-label="What each role can do">
      <THead>
        <Tr>
          <Th>Can…</Th>
          {STAFF.map((r) => (
            <Th key={r} className={COL[r]}>
              {ROLE_LABELS[r]}
            </Th>
          ))}
        </Tr>
      </THead>
      <TBody>
        {GUIDE_MATRIX.map((row) => (
          <Tr key={row.label}>
            <Td>{row.label}</Td>
            {STAFF.map((r) => (
              <Td key={r} className={COL[r]}>
                <RoleMark cell={row.cells[MATRIX_ROLES.indexOf(r)]!} />
              </Td>
            ))}
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}

/** A topic's body: its blocks in order. */
export function ArticleBody({ topic, phone = false }: { topic: Topic; phone?: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      {topic.blocks.map((b, i) => (
        <BlockView key={`${b.kind}-${i}`} block={b} phone={phone} />
      ))}
    </div>
  );
}

/** "Related screens" on desktop. */
export function RelatedScreens({ links }: { links: readonly RelatedLink[] }) {
  if (!links.length) return null;
  return (
    <div className="flex flex-col gap-2.5">
      <span className={CAPS}>RELATED SCREENS</span>
      <div className="flex flex-wrap gap-2">
        {links.map((r) => (
          <Button
            key={r.href}
            variant="secondary"
            size="sm"
            href={r.href}
            icon={GUIDE_ICONS[r.icon]}
            touchHeight
          >
            {r.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
