'use client';

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  IconButton,
  PageHeader,
  Select,
  Switch,
  TextField,
} from '@jirawatpyk/aura-react';
import { IconCheck, IconGlobe, IconInfo, IconPlus, IconTrash2 } from '@jirawatpyk/aura-react/icons';
import {
  defaultSlowMs,
  hostnameSchema,
  isRefusedHeader,
  MAX_KEY_PAGES,
  REFUSED_HEADER_MESSAGE,
  type Tier,
} from '@dxt/shared';
import { SiteStatusBadge } from '@/components/status-badges';
import { saveMonitors } from '../actions';
import type { MonitorRecord, SiteActionResult } from '../types';
import {
  describeChanges,
  isEdited,
  monitorTitle,
  pathOf,
  toDrafts,
  toSaveInput,
  type MonitorDraft,
} from './monitor-drafts';
import { PhraseList } from './phrase-list';
import { EDITOR_LIST, EDITOR_PANE, EDITOR_SPLIT } from './layout';
import { TestCheckCard } from './test-check-card';
import { PHONE_BAR_HEADER } from '@/components/phone-header';

interface MonitorsEditorProps {
  siteId: string;
  siteName: string;
  tier: Tier;
  ownerName: string | null;
  backupName: string | null;
  monitors: MonitorRecord[];
  /** The page header's breadcrumb and meta line; the editor adds its Save / Cancel actions. */
  breadcrumb: React.ReactNode;
  meta: ReactNode;
  /** Just saved (`?saved=1`). */
  saved: boolean;
}

/**
 * EditMonitors (docs/design/screens.md): the HTTP primary and up to 3 key pages, each with its
 * request, content checks, allowed final hosts, custom headers and slow threshold (D-025). Nothing
 * changes until Save changes; SSL and domain monitors join with S13.
 */
export function MonitorsEditor({
  siteId,
  siteName,
  tier,
  ownerName,
  backupName,
  monitors,
  breadcrumb,
  meta,
  saved,
}: MonitorsEditorProps) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<MonitorDraft[]>(() => toDrafts(monitors));
  const [selected, setSelected] = useState(drafts[0]?.key ?? '');
  const [result, setResult] = useState<SiteActionResult | null>(null);
  const [errorKeys, setErrorKeys] = useState<string[]>([]);
  const [askRemove, setAskRemove] = useState<string | null>(null);
  const [askDiscard, setAskDiscard] = useState(false);
  const lastRemoved = useRef<string | null>(null);
  // Undo swaps the "Removed on save" row back to a button: focus it once it exists (keyboard users
  // would otherwise land on <body>).
  const focusRow = useRef<string | null>(null);
  useEffect(() => {
    if (!focusRow.current) return;
    document.querySelector<HTMLElement>(`[data-row="${focusRow.current}"]`)?.focus();
    focusRow.current = null;
  });
  const [pending, startTransition] = useTransition();

  const changes = describeChanges(drafts, monitors);
  const dirty = changes.length > 0;
  const live = drafts.filter((d) => !d.removed);
  const keyPages = live.filter((d) => !d.isPrimary).length;
  const hasNew = drafts.some((d) => !d.id && !d.removed);
  const current = drafts.find((d) => d.key === selected && !d.removed) ?? live[0];
  const origin = (() => {
    try {
      return new URL(monitors.find((m) => m.isPrimary)?.url ?? '').origin;
    } catch {
      return '';
    }
  })();

  const update = (key: string, patch: Partial<MonitorDraft>) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  // Field errors from the server name `upserts.<i>.<field>`; map them back to the draft.
  const fieldErrors = result && !result.ok ? (result.fieldErrors ?? {}) : {};
  // A field's error, or the first error inside it (an array or one of its items).
  const errorOf = (key: string, field: string) => {
    const i = errorKeys.indexOf(key);
    if (i < 0) return undefined;
    const prefix = field ? `upserts.${i}.${field}` : `upserts.${i}`;
    return Object.entries(fieldErrors).find(([k]) => k === prefix || k.startsWith(`${prefix}.`))?.[1];
  };

  const addMonitor = () => {
    const key = `new-${Date.now()}`;
    const primary = drafts.find((d) => d.isPrimary);
    setDrafts((ds) => [
      ...ds,
      {
        key,
        id: null,
        removed: false,
        isPrimary: false,
        url: `${origin}/`,
        method: 'GET',
        timeoutSec: primary?.timeoutSec ?? 30,
        mustContain: [],
        mustNotContain: [],
        allowedRedirectDomains: primary?.allowedRedirectDomains ?? [],
        slowMs: null,
        headers: primary?.headers ?? [],
        enabled: true,
      },
    ]);
    setSelected(key);
  };

  const save = () => {
    const { input, keys } = toSaveInput(siteId, drafts, monitors);
    startTransition(async () => {
      const r = await saveMonitors(input);
      setResult(r);
      setErrorKeys(keys);
      if (r.ok) return router.replace(`/sites/${siteId}/monitors?saved=1`);
      // Show the first monitor that has an error.
      const errored = Object.keys(r.fieldErrors ?? {});
      const first = keys.findIndex((_, i) => errored.some((k) => k.startsWith(`upserts.${i}.`)));
      if (first >= 0) setSelected(keys[first]!);
    });
  };

  const removing = drafts.find((d) => d.key === askRemove);
  const alerted = [ownerName, backupName].filter(Boolean).join(' and ');
  const people = [ownerName && `owner ${ownerName}`, backupName && `backup ${backupName}`]
    .filter(Boolean)
    .join(' · ');
  const addLabel = hasNew
    ? 'Add monitor · save first to add another'
    : keyPages >= MAX_KEY_PAGES
      ? 'Add monitor · max 3 key pages'
      : 'Add monitor';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        className={PHONE_BAR_HEADER}
        // Phones: Cancel / Save side by side across the row, as Site detail (layout-consistency).
        actionsFullWidthBelow="md"
        breadcrumb={breadcrumb}
        title="Edit monitors"
        meta={meta}
        actions={
          <span className="flex flex-wrap items-center justify-end gap-3 max-md:grid max-md:w-full max-md:grid-cols-2">
            {dirty && (
              <span className="text-sm text-alert-warning-fg max-md:col-span-2">
                {changes.length} unsaved {changes.length === 1 ? 'change' : 'changes'}
              </span>
            )}
            {dirty ? (
              <Button variant="secondary" onClick={() => setAskDiscard(true)}>
                Cancel
              </Button>
            ) : (
              <Button variant="secondary" href={`/sites/${siteId}/edit`}>
                Cancel
              </Button>
            )}
            <Button icon={<IconCheck />} disabled={!dirty || pending} loading={pending} onClick={save}>
              {dirty ? 'Save changes' : saved ? 'Saved' : 'No changes'}
            </Button>
          </span>
        }
      />

      {saved && !dirty && (
        <Alert tone="success" role="status" title="Saved — takes effect on the next round">
          Every change is in the audit log.
        </Alert>
      )}

      {result && !result.ok && (
        <Alert tone="danger" role="alert" title="Not saved">
          {result.message}
        </Alert>
      )}

      <div className={EDITOR_SPLIT}>
        <div className={EDITOR_LIST}>
          <div
            role="group"
            aria-label="Monitors"
            className="overflow-hidden rounded-aura-lg border border-border-default bg-bg-surface"
          >
            {drafts.map((d) =>
              d.removed ? (
                d.id && (
                  <div
                    key={d.key}
                    className="flex items-center gap-3 border-b border-border-default bg-bg-canvas px-4 py-3.5"
                  >
                    <span className="flex grow flex-col leading-snug">
                      <span className="text-sm font-semibold text-fg-tertiary line-through">
                        {d.isPrimary ? 'HTTP' : 'Key page'}{' '}
                        <span className="font-mono text-xs font-normal">{pathOf(d.url)}</span>
                      </span>
                      <span className="text-xs text-alert-warning-fg">Removed on save</span>
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      touchHeight
                      data-undo={d.key}
                      onClick={() => {
                        focusRow.current = d.key;
                        update(d.key, { removed: false });
                      }}
                    >
                      Undo
                    </Button>
                  </div>
                )
              ) : (
                <button
                  key={d.key}
                  type="button"
                  aria-pressed={current?.key === d.key}
                  data-row={d.key}
                  onClick={() => {
                    setSelected(d.key);
                    // Below lg the card sits under the list: bring it into view.
                    if (window.matchMedia('(max-width: 1023px)').matches) {
                      requestAnimationFrame(() =>
                        document.getElementById('monitor-card')?.scrollIntoView({ block: 'start' }),
                      );
                    }
                  }}
                  className={`flex min-h-11 w-full cursor-pointer items-center gap-3 border-b border-border-default px-4 py-3.5 text-left hover:bg-bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring ${current?.key === d.key ? 'bg-bg-selected border-l-4 border-l-accent-violet' : ''}`}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-aura-sm border border-border-default bg-bg-canvas text-fg-secondary [&_svg]:size-4">
                    <IconGlobe />
                  </span>
                  <span className="flex min-w-0 grow flex-col leading-snug">
                    <span className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold">{d.isPrimary ? 'HTTP' : 'Key page'}</span>
                      {d.isPrimary && (
                        <Badge tone="neutral" variant="outline">
                          Primary
                        </Badge>
                      )}
                      {errorOf(d.key, '') && <span className="text-xs text-fg-danger">Has errors</span>}
                      {isEdited(d, monitors) && (
                        <span
                          className="size-2 rounded-aura-full bg-alert-warning-fg"
                          role="img"
                          aria-label="Edited, not saved"
                          title="Edited, not saved"
                        />
                      )}
                    </span>
                    <span className="truncate font-mono text-xs text-fg-secondary">
                      {d.id
                        ? `${d.method} ${pathOf(d.url)}`
                        : 'New monitor · added on save · stops at PROBLEM'}
                    </span>
                  </span>
                  <span
                    className={`font-mono text-xs ${d.isPrimary ? 'text-fg-danger' : 'text-fg-secondary'}`}
                  >
                    {d.isPrimary ? 'DOWN' : 'PROBLEM'}
                  </span>
                </button>
              ),
            )}
            <div className="px-4 py-3">
              <Button
                variant="ghost"
                size="sm"
                touchHeight
                icon={<IconPlus />}
                disabled={hasNew || keyPages >= MAX_KEY_PAGES}
                onClick={addMonitor}
              >
                {addLabel}
              </Button>
            </div>
          </div>
          <div className="flex gap-2.5 rounded-aura-md border border-border-default bg-bg-surface px-3.5 py-3 text-xs leading-normal text-fg-secondary">
            <span className="flex pt-px [&_svg]:size-4">
              <IconInfo aria-hidden />
            </span>
            <span>
              Only the primary monitor can make the site DOWN. Every other monitor stops at PROBLEM, so a slow
              key page never pages anyone at night.
            </span>
          </div>
        </div>

        {current && (
          <div id="monitor-card" className={`${EDITOR_PANE} scroll-mt-4`}>
            <MonitorCard
              key={current.key}
              draft={current}
              tier={tier}
              errorOf={(field) => errorOf(current.key, field)}
              onChange={(patch) => update(current.key, patch)}
              onRemove={() =>
                current.id
                  ? setAskRemove(current.key)
                  : setDrafts((ds) => ds.filter((d) => d.key !== current.key))
              }
            />
          </div>
        )}
      </div>

      <Dialog
        open={!!removing}
        onClose={() => setAskRemove(null)}
        role="alertdialog"
        size="sm"
        title={removing ? `Remove ${monitorTitle(removing)}?` : 'Remove monitor?'}
        // Focus returns to the row's Undo, not to the trash button that no longer exists.
        finalFocus={() => {
          const key = lastRemoved.current;
          lastRemoved.current = null;
          // null → AURA returns focus to the trash button that opened the dialog.
          return key ? document.querySelector<HTMLElement>(`[data-undo="${key}"]`) : null;
        }}
        description={[siteName, people].filter(Boolean).join(' · ')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAskRemove(null)}>
              Keep monitor
            </Button>
            <Button
              icon={<IconTrash2 />}
              onClick={() => {
                if (removing) {
                  lastRemoved.current = removing.key;
                  update(removing.key, { removed: true });
                }
                setAskRemove(null);
              }}
            >
              Remove monitor
            </Button>
          </>
        }
      >
        {removing && (
          <div className="flex flex-col gap-2 text-sm leading-normal">
            <p className="m-0">
              Checks for {monitorTitle(removing)} ({pathOf(removing.url)}) stop after you save.{' '}
              {alerted
                ? `${alerted} will no longer get PROBLEM alerts from it, and it drops out of the site status.`
                : 'It drops out of the site status.'}
            </p>
            <p className="m-0 text-fg-secondary">
              Nothing changes until you press Save changes. Past results stay in the check log for 90 days.
            </p>
          </div>
        )}
      </Dialog>

      <Dialog
        open={askDiscard}
        onClose={() => setAskDiscard(false)}
        role="alertdialog"
        size="sm"
        title={`Discard ${changes.length} ${changes.length === 1 ? 'change' : 'changes'}?`}
        description={`${siteName} · monitors`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAskDiscard(false)}>
              Keep editing
            </Button>
            <Button href={`/sites/${siteId}/edit`}>Discard changes</Button>
          </>
        }
      >
        <p className="m-0 text-sm leading-normal">
          You will lose: {changes.join(' · ')}. Nothing has been saved yet.
        </p>
      </Dialog>
    </div>
  );
}

interface MonitorCardProps {
  draft: MonitorDraft;
  tier: Tier;
  errorOf: (field: string) => string | undefined;
  onChange: (patch: Partial<MonitorDraft>) => void;
  onRemove: () => void;
}

/** The editor card of one monitor (EditMonitors right column). */
function MonitorCard({ draft: d, tier, errorOf, onChange, onRemove }: MonitorCardProps) {
  const summary = d.isPrimary
    ? 'Primary · the only monitor that can make this site DOWN · always on'
    : d.id
      ? 'Stops at PROBLEM — a slow key page is worth a look, not a page at 3 a.m.'
      : 'New monitor · added on save · stops at PROBLEM';
  const headerErrors = d.headers.map((h) =>
    h.name && isRefusedHeader(h.name) ? REFUSED_HEADER_MESSAGE : undefined,
  );
  return (
    <>
      <div className="aura-card flex flex-col gap-0 p-0">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border-default px-6 py-5">
          <div className="flex flex-col leading-snug">
            <h2 className="m-0 text-lg font-semibold">{monitorTitle(d)}</h2>
            <span className="text-sm text-fg-secondary">{summary}</span>
          </div>
          <div className="flex items-center gap-3">
            {d.isPrimary ? (
              <Badge tone="neutral" variant="outline">
                Always on
              </Badge>
            ) : (
              <Switch label="Enabled" checked={d.enabled} onChange={(enabled) => onChange({ enabled })} />
            )}
            {!d.isPrimary && (
              <IconButton icon={<IconTrash2 />} label="Remove this monitor" onClick={onRemove} />
            )}
          </div>
        </div>

        <Section title="Request">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
            <TextField
              touchHeight
              label="URL"
              required
              inputMode="url"
              value={d.url}
              onChange={(e) => onChange({ url: e.target.value })}
              error={errorOf('url')}
            />
            <Select
              touchHeight
              label="Method"
              options={['GET', 'HEAD']}
              value={d.method}
              onChange={(e) => onChange({ method: e.target.value === 'HEAD' ? 'HEAD' : 'GET' })}
              error={errorOf('method')}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <TextField
              touchHeight
              label="Expected status"
              value="2xx–3xx"
              disabled
              hint="Fixed: 4xx → PROBLEM, 5xx → hard fail"
            />
            <TextField
              touchHeight
              label="Timeout"
              inputMode="numeric"
              suffix="s"
              value={String(d.timeoutSec)}
              onChange={(e) => onChange({ timeoutSec: Number(e.target.value.replace(/\D/g, '')) || 0 })}
              hint="Longer than this = hard fail"
              error={errorOf('timeoutSec')}
            />
            <Select
              touchHeight
              label="Redirects"
              disabled
              options={[{ value: 'follow', label: 'Follow (max 5)' }]}
              value="follow"
              hint="Fixed: every hop is checked"
            />
          </div>
        </Section>

        <Section title="Content checks">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <PhraseList
              title="Must contain"
              addLabel="Add phrase"
              placeholder="Brand name or page title"
              phrases={d.mustContain}
              onChange={(mustContain) => onChange({ mustContain })}
              hint="Missing → PROBLEM (Keyword). Checked on the final page after redirects."
              error={errorOf('mustContain')}
            />
            <PhraseList
              title="Must not contain"
              addLabel="Add phrase"
              placeholder="e.g. Index of /"
              phrases={d.mustNotContain}
              onChange={(mustNotContain) => onChange({ mustNotContain })}
              hint="Found → PROBLEM (Keyword). Checked on the final page after redirects."
              error={errorOf('mustNotContain')}
            />
          </div>
        </Section>

        <Section title="Allowed final hosts">
          <PhraseList
            title="Hosts a redirect may end on"
            addLabel="Add host"
            placeholder="cdn.example.com"
            phrases={d.allowedRedirectDomains}
            onChange={(allowedRedirectDomains) => onChange({ allowedRedirectDomains })}
            clean={(v) => {
              const host = hostnameSchema.safeParse(v);
              return host.success ? host.data : null;
            }}
            hint="A redirect anywhere else → PROBLEM (possible hijack). Checked on every round."
            error={errorOf('allowedRedirectDomains')}
          />
        </Section>

        <Section title="Custom headers" note="Sent from BKK, SIN and TYO to the site’s own address">
          {d.headers.map((h, i) => (
            <div
              key={i}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] md:items-start"
            >
              <TextField
                touchHeight
                label="Header name"
                placeholder="Accept-Language"
                className="font-mono"
                value={h.name}
                onChange={(e) =>
                  onChange({
                    headers: d.headers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                  })
                }
                error={headerErrors[i] ?? errorOf(`headers.${i}.name`)}
              />
              <TextField
                touchHeight
                label="Value"
                className="col-span-2 font-mono md:col-span-1"
                value={h.value}
                onChange={(e) =>
                  onChange({
                    headers: d.headers.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                  })
                }
                error={errorOf(`headers.${i}.value`)}
              />
              <span className="row-start-1 flex self-end md:row-auto">
                <IconButton
                  icon={<IconTrash2 />}
                  label={`Remove header ${h.name || i + 1}`}
                  onClick={() => onChange({ headers: d.headers.filter((_, j) => j !== i) })}
                />
              </span>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Button
              variant="ghost"
              size="sm"
              touchHeight
              icon={<IconPlus />}
              disabled={d.headers.length >= 10}
              onClick={() => onChange({ headers: [...d.headers, { name: '', value: '' }] })}
            >
              Add header
            </Button>
            {errorOf('headers') && (
              <span role="alert" className="text-xs text-fg-danger">
                {errorOf('headers')}
              </span>
            )}
            <span className="text-xs text-fg-secondary">
              Never put passwords or tokens here — anyone with Responder access can read them. User-Agent,
              Cookie and Authorization are set by the monitor itself.
            </span>
          </div>
        </Section>

        <Section title="Thresholds" last>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <TextField
              touchHeight
              label="Slow when p50 is over"
              inputMode="numeric"
              suffix="ms"
              value={d.slowMs === null ? '' : String(d.slowMs)}
              placeholder={String(defaultSlowMs(tier))}
              onChange={(e) => onChange({ slowMs: Number(e.target.value.replace(/\D/g, '')) || null })}
              hint={`Empty = the Tier ${tier} default, ${defaultSlowMs(tier)} ms`}
              error={errorOf('slowMs')}
            />
            <TextField
              touchHeight
              label="For"
              value="3"
              suffix="rounds in a row"
              disabled
              hint="Fixed for every site"
            />
            <Select
              touchHeight
              label="Result"
              disabled
              options={[{ value: 'p', label: 'PROBLEM (slow)' }]}
              value="p"
              hint="Fixed for every site"
            />
          </div>
          {d.isPrimary && (
            <div className="flex flex-wrap items-start gap-2 text-sm leading-normal">
              <SiteStatusBadge status="down" />
              <span className="min-w-0 flex-1">
                When at least <b>2 of 3</b> locations get a hard fail (timeout, 5xx, DNS/TLS error, connection
                refused) on <b>two checks in a row</b> — the second is an immediate recheck about 30 s later.
                Hard fails don’t wait for the browser verifier. Not editable.
              </span>
            </div>
          )}
        </Section>
      </div>

      <TestCheckCard
        title="Test before saving"
        isPrimary={d.isPrimary}
        request={{
          url: d.url,
          method: d.method,
          timeoutSec: d.timeoutSec || 30,
          mustContain: d.mustContain,
          mustNotContain: d.mustNotContain,
          headers: d.headers.filter((h) => h.name.trim()),
        }}
      />
    </>
  );
}

function Section({
  title,
  note,
  last,
  children,
}: {
  title: string;
  note?: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`flex flex-col gap-4 px-6 py-5 ${last ? '' : 'border-b border-border-default'}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 text-sm font-semibold">{title}</h3>
        {note && <span className="text-xs text-fg-secondary">{note}</span>}
      </div>
      {children}
    </section>
  );
}
