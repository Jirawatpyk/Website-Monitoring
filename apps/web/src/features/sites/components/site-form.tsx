'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  IconButton,
  Progress,
  RadioGroup,
  Select,
  Switch,
  TextField,
} from '@jirawatpyk/aura-react';
import {
  IconArrowRight,
  IconCheck,
  IconCircle,
  IconCircleAlert,
  IconCircleCheck,
  IconExternalLink,
  IconFile,
  IconPencil,
  IconPlus,
  IconTrash2,
} from '@jirawatpyk/aura-react/icons';
import {
  blockingItems,
  DEFAULT_MUST_NOT_CONTAIN,
  formatTime,
  itemsLeftText,
  keyPagePathSchema,
  MAX_KEY_PAGES,
  monitorUrlKey,
  normalizeMonitorUrl,
  PROBE_USER_AGENT,
  registrationChecklist,
  TIER_CONFIG,
  type ChecklistItem,
  type Tier,
} from '@dxt/shared';
import { createSite, deleteSite, setSiteMonitoring, updateSite } from '../actions';
import type { RegistrationOptions, SiteActionResult, SiteRecord } from '../types';
import { splitList } from './lists';
import { TestCheckCard } from './test-check-card';

interface SiteFormProps {
  options: RegistrationOptions;
  /** Edit site when given; Add site otherwise. */
  site?: SiteRecord;
  /** The Bangkok probe's fixed IP for the allowlist, when configured. */
  bkkIp: string | null;
  secretHeaderName: string;
  /** "10:08" right after Start monitoring (`?started=1`): the board's Started line. */
  started?: string | null;
}

const TIERS: { value: string; label: string; description: string }[] = [
  {
    value: '1',
    label: 'Tier 1 — 24/7 · every 1 min',
    description: 'Enterprise / transactions · owner responds by day, on-call at night · CEO step at +30 min',
  },
  {
    value: '2',
    label: 'Tier 2 — business hours · every 3 min',
    description:
      'Client sites · Mon–Fri 09:00–18:00 · DOWN still posts at night, escalation waits until 09:00',
  },
  {
    value: '3',
    label: 'Tier 3 — business hours · every 5 min',
    description: 'Internal / DxT group · Mon–Fri 09:00–18:00 · no client updates',
  },
];

const CHECK_ICON: Record<
  ChecklistItem['state'],
  { icon: React.ReactNode; className: string; label: string }
> = {
  done: { icon: <IconCircleCheck />, className: 'text-fg-positive', label: 'Done' },
  todo: { icon: <IconCircle />, className: 'text-fg-tertiary', label: 'To do' },
  blocked: { icon: <IconCircleAlert />, className: 'text-fg-danger', label: 'Blocked' },
};

/**
 * AddSite (docs/design/screens.md) and Edit site (the same form, D-025): the registration
 * checklist decides when monitoring can start (PRD §4); the SQL functions check it again.
 */
export function SiteForm({ options, site, bkkIp, secretHeaderName, started = null }: SiteFormProps) {
  const router = useRouter();
  const editing = !!site;
  const primary = site?.monitors.find((m) => m.isPrimary);
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(site?.name ?? '');
  const [clientId, setClientId] = useState(site?.clientId ?? '');
  const [url, setUrl] = useState(primary?.url ?? '');
  const [hosting, setHosting] = useState(site?.hosting ?? '');
  const [credentialRef, setCredentialRef] = useState(site?.credentialRef ?? '');
  const [tier, setTier] = useState<Tier>(site?.tier ?? 2);
  const [primaryOwnerId, setPrimaryOwnerId] = useState(site?.primaryOwnerId ?? '');
  const [backupOwnerId, setBackupOwnerId] = useState(site?.backupOwnerId ?? '');
  const [method, setMethod] = useState<'GET' | 'HEAD'>('GET');
  const [timeoutSec, setTimeoutSec] = useState('30');
  const [keyword, setKeyword] = useState(primary?.mustContain[0] ?? '');
  const [mustNot, setMustNot] = useState(DEFAULT_MUST_NOT_CONTAIN.join(', '));
  const [redirects, setRedirects] = useState('');
  const [keyPages, setKeyPages] = useState<string[]>([]);
  const [newKeyPage, setNewKeyPage] = useState('');
  const [keyPageError, setKeyPageError] = useState<string>();
  const [behindWaf, setBehindWaf] = useState(site?.behindWaf ?? false);
  const [allowlist, setAllowlist] = useState(site?.wafAllowlistConfirmed ?? false);

  const [result, setResult] = useState<SiteActionResult | null>(null);
  const [confirm, setConfirm] = useState<'stop' | 'delete' | null>(null);

  const person = (id: string) => {
    const p = options.people.find((x) => x.id === id);
    return p ? { id: p.id, name: p.name, linked: p.linked } : null;
  };
  const client = options.clients.find((c) => c.id === clientId) ?? null;
  const duplicateOf = useMemo(() => {
    try {
      const key = monitorUrlKey(normalizeMonitorUrl(url));
      return options.existingUrls.find((e) => e.siteId !== site?.id && monitorUrlKey(e.url) === key) ?? null;
    } catch {
      return null;
    }
  }, [url, options.existingUrls, site?.id]);

  const checklist = registrationChecklist({
    url,
    duplicate: !!duplicateOf,
    keyPages: editing
      ? site.monitors.filter((m) => !m.isPrimary).map((m) => new URL(m.url).pathname)
      : keyPages,
    keyword,
    tier,
    primary: person(primaryOwnerId),
    backup: person(backupOwnerId),
    client: client ? { name: client.name, internal: client.internal, amName: client.amName } : null,
    hosting,
    credentialRef,
    behindWaf,
    allowlistConfirmed: allowlist,
  });
  const left = blockingItems(checklist);
  const doneCount = checklist.filter((i) => i.state === 'done').length;
  const live = site?.live ?? false;

  const fieldErrors = result && !result.ok ? (result.fieldErrors ?? {}) : {};
  const err = (key: string) => fieldErrors[key] ?? fieldErrors[`site.${key}`];

  const siteInput = () => ({
    name,
    clientId,
    tier,
    primaryOwnerId: primaryOwnerId || null,
    backupOwnerId: backupOwnerId || null,
    hosting,
    credentialRef,
    behindWaf,
    wafAllowlistConfirmed: allowlist,
  });

  const run = (
    work: () => Promise<SiteActionResult>,
    then?: (r: Extract<SiteActionResult, { ok: true }>) => void,
  ) =>
    startTransition(async () => {
      const r = await work();
      setResult(r);
      if (r.ok) then?.(r);
    });

  const save = (start: boolean) =>
    run(
      () =>
        createSite({
          site: siteInput(),
          primary: {
            isPrimary: true,
            url,
            method,
            timeoutSec: Number(timeoutSec),
            mustContain: keyword.trim() ? [keyword.trim()] : [],
            mustNotContain: splitList(mustNot),
            allowedRedirectDomains: splitList(redirects),
          },
          keyPages,
          start,
        }),
      // The edit page says what happened ("Draft saved" / "Monitoring started").
      (r) =>
        router.push(
          `/sites/${r.siteId}/edit?${start ? `started=${encodeURIComponent(formatTime(new Date()))}` : 'draft=1'}`,
        ),
    );

  const addKeyPage = () => {
    const parsed = keyPagePathSchema.safeParse(newKeyPage);
    if (!parsed.success) return setKeyPageError(parsed.error.issues[0]?.message);
    if (!keyPages.includes(parsed.data)) setKeyPages([...keyPages, parsed.data]);
    setNewKeyPage('');
    setKeyPageError(undefined);
  };

  const peopleOptions = options.people.map((p) => ({
    value: p.id,
    label: p.linked ? p.name : `${p.name} · no Chat id`,
    disabled: !p.linked,
  }));
  const interval = TIER_CONFIG[tier].intervalSec / 60;

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
        <Card title="Site" headingLevel={2}>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <TextField
                touchHeight
                label="Site name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                error={err('name')}
              />
              <Select
                touchHeight
                label="Client"
                required
                placeholder="Choose the client"
                options={options.clients.map((c) => ({
                  value: c.id,
                  label: c.name,
                }))}
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                error={err('clientId')}
              />
              <TextField
                touchHeight
                label="Primary URL"
                required
                icon={<IconExternalLink />}
                placeholder="https://"
                inputMode="url"
                value={url}
                readOnly={editing}
                onChange={(e) => setUrl(e.target.value)}
                hint={editing ? 'Change it on Edit monitors' : undefined}
                error={
                  duplicateOf
                    ? 'Already monitored as another site — open that site instead of adding a duplicate.'
                    : err('primary.url')
                }
              />
              <TextField
                touchHeight
                label="Hosting provider"
                required
                value={hosting}
                onChange={(e) => setHosting(e.target.value)}
              />
            </div>
            <TextField
              touchHeight
              label="Credential reference"
              required
              placeholder="e.g. 1Password › Internal › Site name"
              value={credentialRef}
              onChange={(e) => setCredentialRef(e.target.value)}
              hint="Where the team finds access. Never paste the password itself — the system does not store credentials."
            />
          </div>
        </Card>

        <Card title="Tier" headingLevel={2}>
          <RadioGroup
            touchHeight
            label="Tier sets check interval, response hours and escalation timers"
            options={TIERS}
            value={String(tier)}
            onChange={(v) => setTier(Number(v) as Tier)}
          />
        </Card>

        <Card title="Ownership" headingLevel={2}>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Select
                touchHeight
                label="Primary owner"
                required
                placeholder="Choose the owner"
                options={peopleOptions}
                value={primaryOwnerId}
                onChange={(e) => setPrimaryOwnerId(e.target.value)}
              />
              <Select
                touchHeight
                label="Backup owner"
                required
                placeholder="Choose the backup"
                options={peopleOptions.map((o) =>
                  o.value === primaryOwnerId ? { ...o, label: `${o.label} (primary)`, disabled: true } : o,
                )}
                value={backupOwnerId}
                onChange={(e) => setBackupOwnerId(e.target.value)}
                hint={backupOwnerId && backupOwnerId !== primaryOwnerId ? 'Not the primary owner' : undefined}
                error={
                  backupOwnerId && backupOwnerId === primaryOwnerId
                    ? 'Same as primary — pick another'
                    : err('backupOwnerId')
                }
              />
              {client && !client.internal ? (
                <Select
                  touchHeight
                  label="Account manager"
                  disabled
                  options={[{ value: 'am', label: client.amName ?? 'Not set' }]}
                  value="am"
                  hint={
                    client.amName
                      ? 'Gets client-update drafts · set on the client'
                      : 'Ask an Admin to set the client’s AM'
                  }
                />
              ) : (
                <Select
                  touchHeight
                  label="Account manager"
                  disabled
                  options={[{ value: 'none', label: 'None' }]}
                  value="none"
                  hint={client ? 'Internal site — not needed' : 'Choose the client first'}
                />
              )}
            </div>
            <span className="text-xs leading-normal text-fg-secondary">
              Owners need a Google Chat id before they can be assigned.
            </span>
          </div>
        </Card>

        {editing ? (
          <Card
            title="Monitors"
            headingLevel={2}
            actions={
              <Button variant="secondary" size="sm" icon={<IconPencil />} href={`/sites/${site.id}/monitors`}>
                Edit monitors
              </Button>
            }
          >
            <span className="text-sm text-fg-secondary">
              {site.monitors.length === 1
                ? 'The primary monitor only.'
                : `The primary monitor and ${site.monitors.length - 1} key ${site.monitors.length === 2 ? 'page' : 'pages'}.`}{' '}
              URL, keywords, headers and thresholds are edited there.
            </span>
          </Card>
        ) : (
          <Card
            title="Primary monitor"
            headingLevel={2}
            actions={
              <Badge tone="neutral" variant="outline">
                Primary
              </Badge>
            }
          >
            <div className="flex flex-col gap-4">
              <span className="text-sm leading-normal text-fg-secondary">
                Only this monitor can make the site DOWN: at least 2 of 3 locations get a hard fail (timeout,
                5xx, DNS/TLS error, connection refused) on two checks in a row — the second is an immediate
                recheck about 30 s later. Key pages and every other monitor stop at PROBLEM.
              </span>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Select
                  touchHeight
                  label="Method"
                  options={['GET', 'HEAD']}
                  value={method}
                  onChange={(e) => setMethod(e.target.value === 'HEAD' ? 'HEAD' : 'GET')}
                  error={err('primary.method')}
                />
                <TextField
                  touchHeight
                  label="Expected status"
                  value="2xx–3xx"
                  disabled
                  hint="Fixed: 4xx on a key page → PROBLEM, 5xx → hard fail"
                />
                <TextField
                  touchHeight
                  label="Timeout"
                  inputMode="numeric"
                  suffix="s"
                  value={timeoutSec}
                  onChange={(e) => setTimeoutSec(e.target.value)}
                  error={err('primary.timeoutSec')}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <TextField
                  touchHeight
                  label="Must contain (brand keyword)"
                  required
                  placeholder="Brand name or page title"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  hint="Missing → PROBLEM (Keyword)"
                />
                <TextField
                  touchHeight
                  label="Must not contain"
                  value={mustNot}
                  onChange={(e) => setMustNot(e.target.value)}
                  hint="Comma-separated · found → PROBLEM (Keyword)"
                />
              </div>
              <TextField
                touchHeight
                label="Allowed redirect domains"
                placeholder="site domain, CDN domain"
                value={redirects}
                onChange={(e) => setRedirects(e.target.value)}
                hint="A redirect anywhere else → PROBLEM (possible hijack)"
                error={err('primary.allowedRedirectDomains.0')}
              />
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">
                  Key pages <span className="font-normal text-fg-secondary">— top out at PROBLEM</span>
                </span>
                {keyPages.map((k) => (
                  <div
                    key={k}
                    className="flex items-center gap-3 rounded-aura-md border border-border-default px-3.5 py-1 text-sm"
                  >
                    <span className="grow font-mono text-xs">{k}</span>
                    <span className="text-fg-secondary">Expect 2xx–3xx</span>
                    <IconButton
                      icon={<IconTrash2 />}
                      label={`Remove ${k}`}
                      size="sm"
                      onClick={() => setKeyPages(keyPages.filter((x) => x !== k))}
                    />
                  </div>
                ))}
                {keyPages.length === 0 && (
                  <span className="text-xs text-fg-secondary">
                    No key pages — optional. The home page is always checked.
                  </span>
                )}
                <div className="flex flex-wrap items-end gap-2">
                  <TextField
                    touchHeight
                    label="Key page path"
                    placeholder="/contact"
                    className="min-w-0 grow"
                    value={newKeyPage}
                    disabled={keyPages.length >= MAX_KEY_PAGES}
                    onChange={(e) => setNewKeyPage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addKeyPage();
                      }
                    }}
                    error={
                      keyPageError ??
                      Object.entries(fieldErrors).find(([k]) => k.startsWith('keyPages.'))?.[1]
                    }
                  />
                  <Button
                    variant="ghost"
                    icon={<IconPlus />}
                    disabled={keyPages.length >= MAX_KEY_PAGES || !newKeyPage.trim()}
                    onClick={addKeyPage}
                  >
                    {keyPages.length >= MAX_KEY_PAGES ? 'Add key page · max 3 per site' : 'Add key page'}
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <Card
          title="Registration checklist"
          headingLevel={2}
          actions={
            <span className="text-sm font-semibold tabular-nums">
              {doneCount}/{checklist.length}
            </span>
          }
        >
          <div className="flex flex-col gap-3">
            <Progress value={doneCount} max={checklist.length} aria-label="Checklist progress" size="sm" />
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {checklist.map((c) => {
                const look = CHECK_ICON[c.state];
                return (
                  <li key={c.key} className="flex gap-2.5 text-sm leading-normal">
                    <span
                      className={`flex pt-0.5 [&_svg]:size-4 ${look.className}`}
                      role="img"
                      aria-label={look.label}
                    >
                      {look.icon}
                    </span>
                    <span className="flex flex-col">
                      <span className="font-medium">{c.label}</span>
                      <span className="text-xs text-fg-secondary">{c.detail}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-col gap-2 border-t border-border-default pt-3">
              {result && !result.ok && !confirm && (
                <Alert tone="danger" role="alert" title="Not saved">
                  {result.message}
                </Alert>
              )}
              {editing ? (
                <EditActions
                  live={live}
                  pending={pending}
                  blocked={left.length > 0}
                  onSave={() =>
                    run(
                      () => updateSite({ siteId: site.id, site: siteInput() }),
                      () => router.replace(`/sites/${site.id}/edit?saved=1`),
                    )
                  }
                  onStart={() =>
                    run(
                      async () => {
                        const saved = await updateSite({ siteId: site.id, site: siteInput() });
                        return saved.ok ? setSiteMonitoring(site.id, true) : saved;
                      },
                      // A fresh render of the live site, with the board's "Started …" line.
                      () =>
                        router.replace(
                          `/sites/${site.id}/edit?started=${encodeURIComponent(formatTime(new Date()))}`,
                        ),
                    )
                  }
                  onStop={() => setConfirm('stop')}
                  onDelete={() => setConfirm('delete')}
                />
              ) : (
                <Button
                  icon={<IconCircleCheck />}
                  fullWidth
                  disabled={left.length > 0 || pending}
                  loading={pending}
                  onClick={() => save(true)}
                >
                  Start monitoring
                </Button>
              )}
              {left.length > 0 && (
                <span className="text-center text-xs leading-normal text-alert-warning-fg">
                  {live
                    ? `A monitored site can’t be saved without: ${left.map((i) => i.short).join(', ')}`
                    : itemsLeftText(checklist)}
                </span>
              )}
              {started && (
                <span className="text-center text-xs leading-normal text-fg-positive">
                  Started {started} · first round within {interval} min from BKK, SIN and TYO · in the audit
                  log.
                </span>
              )}
              {!editing && (
                <Button
                  variant="secondary"
                  fullWidth
                  icon={<IconFile />}
                  disabled={pending}
                  onClick={() => save(false)}
                >
                  Save draft
                </Button>
              )}
            </div>
          </div>
        </Card>

        <TestCheckCard
          beforeStart={!editing}
          request={
            editing && primary
              ? {
                  url: primary.url,
                  method: primary.method,
                  timeoutSec: primary.timeoutSec,
                  mustContain: primary.mustContain,
                  mustNotContain: primary.mustNotContain,
                  headers: primary.headers,
                }
              : {
                  url,
                  method,
                  timeoutSec: Number(timeoutSec) || 30,
                  mustContain: keyword.trim() ? [keyword.trim()] : [],
                  mustNotContain: splitList(mustNot),
                  headers: [],
                }
          }
        />

        <Card title="Bot protection" headingLevel={2}>
          <div className="flex flex-col gap-4">
            <Switch label="Behind WAF / Cloudflare" checked={behindWaf} onChange={setBehindWaf} />
            {behindWaf && (
              <div className="flex flex-col gap-3">
                <span className="text-sm leading-relaxed text-fg-secondary">
                  Ask the site admin to allowlist the probes. Until they confirm, blocked results go to
                  browser verification (slower, uses VPS capacity).
                </span>
                <dl className="m-0 flex flex-col overflow-hidden rounded-aura-md border border-border-default">
                  {[
                    ['BKK IP (FIXED)', bkkIp ?? 'Ask an Admin for the VPS IP'],
                    ['USER-AGENT', PROBE_USER_AGENT],
                    ['SECRET HEADER (SIN, TYO)', `${secretHeaderName}: ••••••`],
                  ].map(([k, v], i) => (
                    <div
                      key={k}
                      className={`flex flex-col px-3.5 py-3 leading-normal ${i < 2 ? 'border-b border-border-default' : ''}`}
                    >
                      <dt className="font-mono text-xs text-fg-tertiary">{k}</dt>
                      <dd className="m-0 font-mono text-xs">{v}</dd>
                    </div>
                  ))}
                </dl>
                <Checkbox checked={allowlist} onChange={setAllowlist}>
                  Site admin confirmed the allowlist
                </Checkbox>
              </div>
            )}
          </div>
        </Card>
      </div>

      {editing && (
        <>
          <Dialog
            open={confirm === 'stop'}
            onClose={() => setConfirm(null)}
            role="alertdialog"
            size="sm"
            title={`Stop monitoring ${site.name}?`}
            description={
              [site.ownerName, site.backupName].filter(Boolean).length
                ? `Owner and backup: ${[site.ownerName, site.backupName].filter(Boolean).join(' and ')}`
                : undefined
            }
            footer={
              <>
                <Button variant="secondary" onClick={() => setConfirm(null)}>
                  Keep monitoring
                </Button>
                <Button
                  variant="danger"
                  loading={pending}
                  onClick={() =>
                    run(
                      () => setSiteMonitoring(site.id, false),
                      () => {
                        setConfirm(null);
                        router.replace(`/sites/${site.id}/edit?stopped=1`);
                      },
                    )
                  }
                >
                  Stop monitoring
                </Button>
              </>
            }
          >
            {result && !result.ok && (
              <Alert tone="danger" role="alert" title="Not done">
                {result.message}
              </Alert>
            )}
            <p className="m-0 text-sm leading-normal">
              Checks stop now and nobody is alerted about this site. An open incident stays open. You can
              start monitoring again from this page.
            </p>
          </Dialog>
          <Dialog
            open={confirm === 'delete'}
            onClose={() => setConfirm(null)}
            role="alertdialog"
            size="sm"
            title={`Delete ${site.name}?`}
            description="A draft that was never monitored"
            footer={
              <>
                <Button variant="secondary" onClick={() => setConfirm(null)}>
                  Keep draft
                </Button>
                <Button
                  variant="danger"
                  loading={pending}
                  onClick={() =>
                    run(
                      () => deleteSite(site.id),
                      () => router.push('/sites'),
                    )
                  }
                >
                  Delete site
                </Button>
              </>
            }
          >
            {result && !result.ok && (
              <Alert tone="danger" role="alert" title="Not done">
                {result.message}
              </Alert>
            )}
            <p className="m-0 text-sm leading-normal">
              The draft and its monitors are removed. This can’t be undone; the audit log keeps a record.
            </p>
          </Dialog>
        </>
      )}
    </div>
  );
}

interface EditActionsProps {
  live: boolean;
  pending: boolean;
  blocked: boolean;
  onSave: () => void;
  onStart: () => void;
  onStop: () => void;
  onDelete: () => void;
}

/** Edit site: Save changes, and Start / Stop monitoring or Delete a draft (D-025). */
function EditActions({ live, pending, blocked, onSave, onStart, onStop, onDelete }: EditActionsProps) {
  // A stopped site with check results or incidents is refused by delete_site, which says why.
  const deleteReason = live ? 'Has monitoring history — stop monitoring instead' : null;
  return (
    <>
      <Button
        icon={<IconCheck />}
        fullWidth
        disabled={pending || (live && blocked)}
        loading={pending}
        onClick={onSave}
      >
        Save changes
      </Button>
      {live ? (
        <Button variant="secondary" fullWidth disabled={pending} onClick={onStop}>
          Stop monitoring
        </Button>
      ) : (
        <Button
          variant="secondary"
          fullWidth
          icon={<IconArrowRight />}
          disabled={pending || blocked}
          onClick={onStart}
        >
          Start monitoring
        </Button>
      )}
      <Button
        variant="danger-secondary"
        fullWidth
        icon={<IconTrash2 />}
        disabled={pending || !!deleteReason}
        onClick={onDelete}
      >
        Delete site
      </Button>
      {deleteReason && <span className="text-center text-xs text-fg-secondary">{deleteReason}</span>}
    </>
  );
}
