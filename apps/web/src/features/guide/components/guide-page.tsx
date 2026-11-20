'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Button, SegmentedControl, Tag, TextField } from '@jirawatpyk/aura-react';
import {
  IconArrowUpRight,
  IconChevronRight,
  IconMonitor,
  IconSearch,
  IconX,
} from '@jirawatpyk/aura-react/icons';
import type { Topic } from '../content';
import {
  CHIPS,
  SEARCH_SUGGESTIONS,
  countLabel,
  emptyTitle,
  forText,
  groupTopics,
  nextSelection,
  phoneCountLine,
  visibleTopics,
  type Chip,
  type GuideRole,
} from '../model';
import { ArticleBody, GUIDE_ICONS, RelatedScreens } from './article-body';

const CAPS = 'font-mono text-xs text-fg-tertiary';
const FIRST_TOPIC = 'alert';

/**
 * The User guide (boards Guide, MGuide; spec §18; S18, D-070). One state drives both trees: from lg
 * the topic list beside the article, below lg the list and a drill-in article (`?topic=`), where the
 * Admin topic is split in two.
 */
export function GuidePage({
  desktop,
  phone,
  mine,
}: {
  desktop: Topic[];
  phone: Topic[];
  /** The chip the guide opens on: the viewer's role, or On-call during their shift. */
  mine: GuideRole;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openId = params.get('topic');
  const [chip, setChip] = useState<Chip>(mine);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string>(() => {
    const wanted = openId && desktop.some((t) => t.id === openId) ? openId : FIRST_TOPIC;
    return nextSelection(desktop, mine, '', wanted) ?? wanted;
  });

  // Focus follows a pick (desktop) or an open (phone) — after React rendered the target. A pick
  // moves focus once; a selection the search or a chip changes leaves it in the field (code review).
  const articleHeading = useRef<HTMLHeadingElement>(null);
  const phoneHeading = useRef<HTMLHeadingElement>(null);
  const phoneList = useRef<HTMLDivElement>(null);
  const picked = useRef(false);
  useEffect(() => {
    if (!picked.current) return;
    picked.current = false;
    articleHeading.current?.focus();
  }, [sel]);
  // The topic the phone last opened: Back returns focus to its row.
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!opened.current) return;
    if (openId) phoneHeading.current?.focus();
    else {
      phoneList.current?.querySelector<HTMLElement>(`[data-topic="${opened.current}"]`)?.focus();
      opened.current = null;
    }
  }, [openId]);

  const refilter = (nextChip: Chip, nextQ: string) => {
    picked.current = false;
    setChip(nextChip);
    setQ(nextQ);
    const id = nextSelection(desktop, nextChip, nextQ, sel);
    if (id) setSel(id);
  };
  const clear = () => refilter('All', '');
  const pick = (id: string) => {
    picked.current = true;
    setSel(id);
  };
  const open = (id: string) => {
    opened.current = id;
    router.push(`${pathname}?topic=${id}`);
  };

  const shownDesktop = visibleTopics(desktop, chip, q);
  const shownPhone = visibleTopics(phone, chip, q);
  const current = desktop.find((t) => t.id === sel) ?? desktop[0]!;
  const phoneTopic = openId ? phone.find((t) => t.id === openId) : undefined;
  const isMine = chip === mine && !q.trim();
  const filtered = !!q.trim() || (chip !== 'All' && chip !== mine);

  const search = (
    <TextField
      label="Search the guide"
      icon={<IconSearch />}
      placeholder="e.g. mute, 2-step, root cause"
      value={q}
      onChange={(e) => refilter(chip, e.target.value)}
      touchHeight
    />
  );

  const mineLine = (
    <span className="flex flex-wrap items-center gap-2 text-xs text-fg-secondary">
      <span>
        Showing topics for you · <span className="font-medium text-fg-primary">{mine}</span>
      </span>
      <button
        type="button"
        onClick={() => refilter('All', q)}
        className="cursor-pointer rounded-aura-sm border-0 bg-transparent p-0 text-xs font-medium text-fg-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring pointer-coarse:min-h-11"
      >
        Show all
      </button>
    </span>
  );

  const empty = (shown: number, phoneLayout: boolean) =>
    shown === 0 && (
      <div className="flex flex-col gap-3 rounded-aura-md border border-dashed border-border-default p-5 leading-normal">
        <span className="flex text-fg-tertiary">
          <IconSearch />
        </span>
        <span className="font-semibold">{emptyTitle(q, chip)}</span>
        <span className="text-sm text-fg-secondary">
          {phoneLayout
            ? 'Try “acknowledge”, “mute” or “root cause”, or show all roles.'
            : 'Try one of these, or ask in DxT Website Alerts.'}
        </span>
        {!phoneLayout && (
          <div className="flex flex-wrap gap-2">
            {SEARCH_SUGGESTIONS.map((w) => (
              <Tag key={w} onClick={() => refilter('All', w)}>
                {w}
              </Tag>
            ))}
          </div>
        )}
        <span className="flex">
          <Button variant="secondary" size="sm" icon={<IconX />} onClick={clear} fullWidth="below-md">
            Clear search and filters
          </Button>
        </span>
      </div>
    );

  return (
    <>
      {/* ── Desktop (Guide) ───────────────────────────────────────────── */}
      <div className="flex flex-col gap-6 max-lg:hidden">
        <div className="flex items-end justify-between gap-6">
          <div className="flex w-95 flex-col">{search}</div>
          <div className="flex flex-col gap-1">
            {isMine ? mineLine : <span className="text-xs text-fg-secondary">Show topics for</span>}
            <SegmentedControl
              label="Show topics for"
              options={[...CHIPS]}
              value={chip}
              onChange={(v) => refilter(v as Chip, q)}
              size="sm"
            />
          </div>
        </div>
        <div className="-mt-1 grid grid-cols-[calc(var(--spacing)*75)_minmax(0,1fr)] items-start gap-6">
          <nav aria-label="Guide topics" className="flex flex-col gap-4">
            <div className="flex min-h-8 items-center justify-between gap-2 text-sm text-fg-secondary">
              <span>{countLabel(shownDesktop.length, desktop.length, chip, mine, q)}</span>
              {filtered && shownDesktop.length > 0 && (
                <Button variant="ghost" size="sm" icon={<IconX />} onClick={clear}>
                  Clear
                </Button>
              )}
            </div>
            {groupTopics(shownDesktop).map((g) => (
              <div key={g.group} className="flex flex-col gap-0.5">
                <span className="px-3 pb-1 font-mono text-xs tracking-wide text-fg-tertiary">
                  {g.group.toUpperCase()}
                </span>
                {g.topics.map((t) => {
                  const on = t.id === current.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => pick(t.id)}
                      aria-current={on ? 'page' : undefined}
                      className={`flex min-h-11 w-full cursor-pointer items-start gap-3 rounded-aura-md border border-transparent px-3 py-2.5 text-left text-fg-primary hover:border-border-default focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring ${on ? 'bg-bg-selected' : 'bg-transparent'}`}
                    >
                      <span
                        className={`flex pt-0.5 [&_svg]:size-4 ${on ? 'text-fg-primary' : 'text-fg-tertiary'}`}
                      >
                        {GUIDE_ICONS[t.icon]}
                      </span>
                      <span className="flex min-w-0 flex-col gap-0.5 leading-snug">
                        <span className={on ? 'font-semibold' : 'font-medium'}>{t.title}</span>
                        <span className="text-xs text-fg-secondary">{t.summary}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
            {empty(shownDesktop.length, false)}
          </nav>
          <article className="aura-card flex flex-col gap-6 px-8 py-7">
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-mono text-xs text-fg-secondary">{current.group.toUpperCase()}</span>
                <span className="text-xs text-fg-secondary">
                  For <span className="font-medium text-fg-primary">{forText(current.roles)}</span>
                </span>
              </div>
              <h2
                ref={articleHeading}
                tabIndex={-1}
                className="m-0 font-display text-3xl leading-tight font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                {current.title}
              </h2>
              <span className="text-base leading-relaxed text-fg-secondary">{current.lede}</span>
            </div>
            <ArticleBody topic={current} />
            <RelatedScreens links={current.related} />
            <div className="border-t border-border-default pt-5 text-sm text-fg-secondary">
              Still stuck? Ask in DxT Website Alerts or message an Admin.
            </div>
          </article>
        </div>
      </div>

      {/* ── Phone (MGuide) ────────────────────────────────────────────── */}
      <div ref={phoneList} className="flex flex-col gap-3 lg:hidden">
        {phoneTopic ? (
          <PhoneArticle topic={phoneTopic} phone={phone} headingRef={phoneHeading} onOpen={open} />
        ) : (
          <>
            {search}
            <div
              role="group"
              aria-label="Filter by role"
              // Wraps rather than scrolling sideways (D-018: no box scrolls sideways at 390).
              className="flex flex-wrap gap-2"
            >
              {CHIPS.map((c) => (
                <Tag key={c} selected={c === chip} onClick={() => refilter(c, q)} touchHeight>
                  {c}
                </Tag>
              ))}
            </div>
            {isMine ? (
              mineLine
            ) : (
              <span className="text-xs text-fg-secondary">
                {phoneCountLine(shownPhone.length, phone.length, chip, mine, q)}
              </span>
            )}
            {groupTopics(shownPhone).map((g) => (
              <div key={g.group} className="flex flex-col gap-1.5">
                <span className={CAPS}>{g.group.toUpperCase()}</span>
                <div className="overflow-hidden rounded-aura-lg border border-border-default bg-bg-surface">
                  {g.topics.map((t) => (
                    <TopicRow key={t.id} topic={t} onOpen={open} />
                  ))}
                </div>
              </div>
            ))}
            {empty(shownPhone.length, true)}
            <span className="flex items-start gap-1.5 text-xs leading-snug text-fg-secondary">
              <span className="flex pt-px">
                <IconMonitor size="sm" />
              </span>
              <span>Same topics as the desktop User guide. Screens for Admin settings open on desktop.</span>
            </span>
          </>
        )}
      </div>
    </>
  );
}

function TopicRow({ topic, onOpen }: { topic: Topic; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(topic.id)}
      data-topic={topic.id}
      className="flex min-h-15 w-full cursor-pointer items-center gap-3 border-0 border-b border-border-subtle bg-transparent py-2.5 pr-2.5 pl-3.5 text-left text-fg-primary last:border-b-0 hover:bg-bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-aura-md bg-bg-canvas text-fg-secondary [&_svg]:size-4">
        {GUIDE_ICONS[topic.icon]}
      </span>
      <span className="flex min-w-0 grow flex-col gap-0.5 leading-snug">
        <span className="font-medium">{topic.title}</span>
        <span className="text-xs text-fg-secondary">{topic.summary}</span>
      </span>
      <span className="flex text-fg-tertiary">
        <IconChevronRight size="sm" />
      </span>
    </button>
  );
}

function PhoneArticle({
  topic,
  phone,
  headingRef,
  onOpen,
}: {
  topic: Topic;
  phone: Topic[];
  headingRef: RefObject<HTMLHeadingElement | null>;
  onOpen: (id: string) => void;
}) {
  const related = topic.relatedTopics.flatMap((id) => phone.filter((t) => t.id === id));
  const screen = topic.related[0];
  return (
    <article className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className={CAPS}>{topic.group.toUpperCase()}</span>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="m-0 font-display text-2xl leading-tight font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          {topic.title}
        </h2>
        <span className="text-xs text-fg-secondary">
          For {forText(topic.roles).replace('Everyone', 'everyone')}
        </span>
      </div>
      <p className="m-0 text-sm leading-relaxed">{topic.lede}</p>
      <ArticleBody topic={topic} />
      {screen && (
        <Button variant="secondary" icon={<IconArrowUpRight />} href={screen.href} fullWidth>
          {`Open ${screen.label}`}
        </Button>
      )}
      {related.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className={CAPS}>RELATED</span>
          <div className="overflow-hidden rounded-aura-lg border border-border-default bg-bg-surface">
            {related.map((t) => (
              <TopicRow key={t.id} topic={t} onOpen={onOpen} />
            ))}
          </div>
        </div>
      )}
      <span className="text-sm text-fg-secondary">
        Still stuck? Ask in DxT Website Alerts or message an Admin.
      </span>
    </article>
  );
}
