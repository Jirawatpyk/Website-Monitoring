import Link from 'next/link';
import type { ReactNode } from 'react';
import { Alert, Badge, Table, TBody, Td, Th, THead, Tr } from '@jirawatpyk/aura-react';
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
  IconSettings,
  IconUser,
  IconUsers,
} from '@jirawatpyk/aura-react/icons';
import { MATRIX_ROLES, ROLE_LABELS, ROLE_MATRIX } from '@dxt/shared';
import { RoleMark } from '@/components/role-mark';
import { GLYPH_LEGEND, GLYPHS } from '@/components/site-cells';
import { SeverityBadge, SiteStatusBadge, WorkflowBadge } from '@/components/status-badges';
import type { Block, GuideIcon, RelatedLink, Step, Topic } from '../content';

/** The icon of a topic or a related screen. */
export const GUIDE_ICONS: Record<GuideIcon, ReactNode> = {
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
          // A picture of the held-action toast, not a live one (Guide board).
          <div
            aria-hidden
            className="flex w-full max-w-130 items-center gap-3.5 rounded-aura-lg bg-bg-surface-strong py-3 pr-3 pl-4.5 text-fg-inverted"
          >
            <IconCheck size="sm" />
            <span className="flex grow flex-col text-sm leading-snug">
              <span className="font-semibold">{step.toast.title}</span>
              <span className="text-xs opacity-75">{step.toast.line}</span>
            </span>
            <span className="flex h-9 shrink-0 items-center rounded-aura-full border border-current px-4 text-sm font-medium">
              {step.toast.undo}
            </span>
          </div>
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

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'bullets':
      return (
        <div className="flex flex-col gap-3">
          {block.items.map((b) => (
            <div key={b.lead} className="flex gap-3 leading-relaxed">
              <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-aura-full bg-fg-tertiary" />
              <span>
                <span className="font-semibold">{b.lead}</span>{' '}
                <span className="text-fg-secondary">{b.text}</span>
              </span>
            </div>
          ))}
        </div>
      );
    case 'steps':
      return (
        <div className="flex flex-col gap-5">
          {block.items.map((s, i) => (
            <StepItem key={s.title} step={s} n={i + 1} />
          ))}
        </div>
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
                    className={`shrink-0 md:w-36 md:text-right ${l.fyi ? 'text-alert-warning-fg' : 'text-fg-secondary'}`}
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
          <span className={CAPS}>THE LIFECYCLE</span>
          <Flow states={block.states} />
          <span className="text-xs leading-normal text-fg-secondary">{block.note}</span>
        </div>
      );
    case 'compare':
      return (
        <div className={`${BOX} overflow-hidden`}>
          <div className="grid grid-cols-[calc(var(--spacing)*33)_1fr_1fr] items-center gap-4 border-b border-border-default bg-bg-canvas px-4 py-2.5 max-md:grid-cols-[calc(var(--spacing)*22)_1fr_1fr] max-md:gap-2">
            <span />
            <span className="flex items-center gap-2 font-semibold">
              <IconEyeOff size="sm" />
              Mute
            </span>
            <span className="flex items-center gap-2 font-semibold">
              <IconCalendar size="sm" />
              Maintenance
            </span>
          </div>
          <Rows
            rows={block.rows}
            render={(m, last) => (
              <div
                key={m.k}
                className={`grid grid-cols-[calc(var(--spacing)*33)_1fr_1fr] gap-4 px-4 py-2.5 text-sm leading-snug max-md:grid-cols-[calc(var(--spacing)*22)_1fr_1fr] max-md:gap-2 max-md:text-xs ${line(last)}`}
              >
                <span className="text-fg-secondary">{m.k}</span>
                <span>{m.mute}</span>
                <span>{m.maint}</span>
              </div>
            )}
          />
        </div>
      );
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
                        Muted · until 18:00
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
      return <Matrix />;
  }
}

/** The role matrix, the client column left out (Phase 3): the same rows Settings › Users shows. */
function Matrix() {
  const roles = MATRIX_ROLES.filter((r) => r !== 'client');
  return (
    <div className="overflow-x-auto">
      <Table aria-label="What each role can do">
        <THead>
          <Tr>
            <Th>Can…</Th>
            {roles.map((r) => (
              <Th key={r}>{ROLE_LABELS[r]}</Th>
            ))}
          </Tr>
        </THead>
        <TBody>
          {ROLE_MATRIX.map((row) => (
            <Tr key={row.label}>
              <Td>{row.label}</Td>
              {roles.map((r, i) => (
                <Td key={r}>
                  <RoleMark cell={row.cells[i]!} />
                </Td>
              ))}
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

/** A topic's body: its blocks in order. */
export function ArticleBody({ topic }: { topic: Topic }) {
  return (
    <div className="flex flex-col gap-5">
      {topic.blocks.map((b, i) => (
        <BlockView key={`${b.kind}-${i}`} block={b} />
      ))}
    </div>
  );
}

/** "Related screens" — pills on desktop. */
export function RelatedScreens({ links }: { links: readonly RelatedLink[] }) {
  if (!links.length) return null;
  return (
    <div className="flex flex-col gap-2.5">
      <span className={CAPS}>RELATED SCREENS</span>
      <div className="flex flex-wrap gap-2">
        {links.map((r) => (
          <Link
            key={r.href}
            href={r.href}
            className="inline-flex h-9 items-center gap-2 rounded-aura-full border border-border-default bg-bg-surface pr-3.5 pl-3 text-sm font-medium whitespace-nowrap text-fg-primary no-underline hover:border-border-control focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring pointer-coarse:h-11"
          >
            <span className="flex text-fg-secondary [&_svg]:size-4">{GUIDE_ICONS[r.icon]}</span>
            {r.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
