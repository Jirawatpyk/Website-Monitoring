'use client';

import {
  Alert,
  Avatar,
  Badge,
  Button,
  DataTable,
  Dialog,
  DropdownMenu,
  IconButton,
  Select,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  type DataTableColumn,
  type MenuItem,
} from '@jirawatpyk/aura-react';
import {
  IconCheck,
  IconChevronRight,
  IconEllipsis,
  IconEye,
  IconMinus,
  IconPlus,
} from '@jirawatpyk/aura-react/icons';
import { ROLE_LABELS, type Role } from '@dxt/shared';
import { useEffect, useRef, useState } from 'react';
import { HandOverDialog, type OncallData } from '@/features/oncall';
import {
  changeBlockedWhy,
  countLine,
  liveShiftOf,
  MATRIX_ROLES,
  oneAdminBanner,
  ROLE_MATRIX,
  roleRows,
  sheetFacts,
  userRows,
  type Person,
  type UserRow,
  type UsersData,
} from '../model';
import { SettingsHeader } from './settings-header';
import { loadHandover } from '../actions';
import { ChatIdDialog, InviteDialog, RevokeDialog, RoleDialog } from './user-dialogs';

const VARIANT: Record<Role, 'solid' | 'soft' | 'outline'> = {
  admin: 'solid',
  responder: 'soft',
  stakeholder: 'outline',
  viewer: 'soft',
  client: 'outline',
};

function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge tone="neutral" variant={VARIANT[role]}>
      {ROLE_LABELS[role]}
    </Badge>
  );
}

type Open =
  | { kind: 'invite' }
  | { kind: 'revoke'; email: string; isAdmin: boolean }
  | { kind: 'role' | 'deactivate' | 'chat' | 'handover'; person: Person }
  | null;

/**
 * Settings › Users & roles (boards Users, MUsers; spec §14.9, §35; S16, D-062). Admin only (the route
 * checks). From md: the table, the ⋯ menu and its dialogs; below md: view only (§22.5) — cards, a
 * sheet per person and the role matrix one role at a time.
 */
export function UsersPageView({ data, now: nowIso }: { data: UsersData; now: string }) {
  const now = new Date(nowIso);
  const rows = userRows(data, now);
  const banner = oneAdminBanner(data);
  const [open, setOpen] = useState<Open>(null);
  const [done, setDone] = useState<string | null>(null);
  // Hand over's On-call data, read when that dialog opens (S16 code review).
  const [oncall, setOncall] = useState<OncallData | null>(null);
  // Focus goes back to the row's ⋯ once its dialog closes (the trigger, S05 /verify).
  const focusKey = useRef<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open || !focusKey.current) return;
    tableRef.current
      ?.querySelector<HTMLElement>(`[data-row-menu="${CSS.escape(focusKey.current)}"]`)
      ?.focus();
    focusKey.current = null;
  }, [open]);
  const close = () => setOpen(null);
  const finish = (line: string) => {
    setDone(line);
    setOpen(null);
  };
  const personOf = (r: UserRow) => data.people.find((p) => p.id === r.personId) ?? null;

  const menuItems = (r: UserRow): MenuItem[] => {
    const show = (o: NonNullable<Open>) => () => {
      focusKey.current = r.key;
      setOpen(o);
    };
    const p = personOf(r);
    if (!p)
      return [
        {
          label: 'Change role…',
          disabled: true,
          disabledReason:
            'Not signed in yet — the role can change after they sign in. To pick another role now, remove the address and add it again.',
        },
        { separator: true as const },
        {
          label: 'Remove from access list…',
          tone: 'danger',
          onSelect: show({ kind: 'revoke', email: r.email, isAdmin: r.role === 'admin' }),
        },
      ];
    const why = changeBlockedWhy(data, p);
    const live = liveShiftOf(data, p.id, now);
    return [
      {
        label: 'Change role…',
        ...(why ? { disabled: true, disabledReason: why } : { onSelect: show({ kind: 'role', person: p }) }),
      },
      ...(live
        ? [
            {
              label: 'Hand over shift…',
              onSelect: () => {
                focusKey.current = r.key;
                void loadHandover().then((d) => {
                  setOncall(d);
                  if (d) setOpen({ kind: 'handover', person: p });
                });
              },
            },
          ]
        : []),
      { label: 'Edit Chat id…', onSelect: show({ kind: 'chat', person: p }) },
      { separator: true as const },
      {
        label: 'Deactivate…',
        tone: 'danger' as const,
        ...(why
          ? { disabled: true, disabledReason: why }
          : { onSelect: show({ kind: 'deactivate', person: p }) }),
      },
    ];
  };

  const columns: DataTableColumn<UserRow>[] = [
    {
      key: 'name',
      label: 'Name',
      grow: 1,
      render: (r) => (
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={r.name} size="sm" />
          <span className="flex min-w-0 flex-col leading-snug">
            <span className="font-medium">{r.name}</span>
            <span className="truncate text-xs text-fg-secondary">{r.sub}</span>
          </span>
        </span>
      ),
    },
    { key: 'role', label: 'Role', width: 120, render: (r) => <RoleBadge role={r.role} /> },
    {
      key: 'channels',
      label: 'Alert channels',
      width: 160,
      // `hideBelow` measures the table's own width (S15): pixels, so 1440 keeps every column.
      hideBelow: 900,
      render: (r) => <span className="text-sm text-fg-secondary">{r.channels}</span>,
    },
    {
      key: 'owns',
      label: 'Owner · backup',
      width: 120,
      hideBelow: 980,
      render: (r) => <span className="tabular-nums">{r.owns}</span>,
    },
    {
      key: 'oncall',
      label: 'On-call',
      width: 160,
      render: (r) => (
        <span className={r.oncall.live ? 'font-semibold' : 'text-fg-secondary'}>{r.oncall.text}</span>
      ),
    },
    { key: 'last', label: 'Last active', width: 140, hideBelow: 780, render: (r) => r.last },
    {
      key: 'actions',
      label: '',
      width: 56,
      actions: true,
      render: (r) => (
        <DropdownMenu
          label={`Actions for ${r.name}`}
          trigger={
            <IconButton icon={<IconEllipsis />} label={`Actions for ${r.name}`} data-row-menu={r.key} />
          }
          items={menuItems(r)}
        />
      ),
    },
  ];

  const p = open && 'person' in open ? open.person : null;
  const handShift =
    open?.kind === 'handover' && oncall
      ? (oncall.shifts.find((s) => s.id === liveShiftOf(data, open.person.id, now)?.id) ?? null)
      : null;

  return (
    <div className="flex flex-col gap-6">
      <SettingsHeader
        current="users"
        actions={
          <span className="hidden md:inline-flex">
            <Button icon={<IconPlus />} onClick={() => setOpen({ kind: 'invite' })}>
              Invite user
            </Button>
          </span>
        }
      />
      <div className="flex items-start gap-2.5 rounded-aura-md border border-border-default bg-bg-surface p-3 text-sm md:hidden">
        <IconEye size="sm" aria-hidden className="mt-0.5 text-fg-secondary" />
        <span>
          <b className="font-semibold">View only on phones.</b>{' '}
          <span className="text-fg-secondary">Admins change policies on a larger screen.</span>
        </span>
      </div>
      {banner && (
        <Alert tone="warning" title={banner.title}>
          {banner.body}
        </Alert>
      )}
      <section className="flex flex-col gap-3" aria-labelledby="people-h">
        <div className="flex flex-col gap-1">
          <h2 id="people-h" className="m-0 hidden text-lg font-semibold md:block">
            Users
          </h2>
          <span
            role="status"
            data-testid="users-count"
            className={`text-sm leading-normal ${done ? 'text-fg-positive' : 'text-fg-secondary'}`}
          >
            {done ?? countLine(data)}
          </span>
        </div>
        <div ref={tableRef} className="hidden md:block">
          <DataTable label="Users" rowKey="key" columns={columns} rows={rows} rowHeight="auto" />
        </div>
        <PeopleCards data={data} rows={rows} />
      </section>
      <section className="flex flex-col gap-3" aria-labelledby="roles-h">
        <h2 id="roles-h" className="m-0 hidden text-lg font-semibold md:block">
          What each role can do
        </h2>
        <span className="font-mono text-xs text-fg-tertiary md:hidden">WHAT EACH ROLE CAN DO</span>
        <p className="m-0 hidden text-sm text-fg-secondary md:block">
          “Own” = sites where the person is primary or backup owner, or clients where they are Site AM.
        </p>
        <div className="hidden md:block">
          <MatrixTable />
        </div>
        <PhoneMatrix />
      </section>

      <InviteDialog open={open?.kind === 'invite'} onClose={close} onDone={finish} />
      <RevokeDialog
        email={open?.kind === 'revoke' ? open.email : null}
        isAdmin={open?.kind === 'revoke' && open.isAdmin}
        onClose={close}
        onDone={finish}
      />
      <RoleDialog
        data={data}
        person={open?.kind === 'role' || open?.kind === 'deactivate' ? p : null}
        mode={open?.kind === 'deactivate' ? 'deactivate' : 'role'}
        now={now}
        onClose={close}
        onDone={finish}
      />
      <ChatIdDialog person={open?.kind === 'chat' ? p : null} onClose={close} onDone={finish} />
      {oncall && handShift && (
        <HandOverDialog
          open
          data={oncall}
          shift={handShift}
          now={now}
          onClose={close}
          onHanded={(h) => finish(`${h.title} · logged`)}
        />
      )}
    </div>
  );
}

/** The desktop matrix (Users board): five roles, ✓ / ✓ + the limit / —. */
function MatrixTable() {
  return (
    <div className="overflow-x-auto rounded-aura-lg border border-border-default">
      <Table>
        <THead>
          <Tr>
            <Th>Permission</Th>
            {MATRIX_ROLES.map((r) => (
              <Th key={r}>
                <span className="flex items-center gap-1.5">
                  {ROLE_LABELS[r]}
                  {r === 'client' && (
                    <Badge tone="neutral" variant="outline">
                      Phase 3
                    </Badge>
                  )}
                </span>
              </Th>
            ))}
          </Tr>
        </THead>
        <TBody>
          {ROLE_MATRIX.map((row) => (
            <Tr key={row.label}>
              <Td>{row.label}</Td>
              {row.cells.map((c, i) => (
                <Td key={i}>
                  <Mark cell={c} />
                </Td>
              ))}
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

function Mark({ cell }: { cell: string }) {
  if (cell === 'Y')
    return (
      <span className="text-fg-positive">
        <IconCheck size="sm" aria-label="Allowed" />
      </span>
    );
  if (cell === 'N')
    return (
      <span className="text-fg-tertiary">
        <IconMinus size="sm" aria-label="Not allowed" />
      </span>
    );
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-fg-secondary">
        <IconCheck size="sm" aria-label="Allowed with limits" />
      </span>
      <span className="text-xs leading-snug text-fg-secondary">{cell}</span>
    </span>
  );
}

/** MUsers' matrix (§35.4): a Role select over one role's ten rows. */
function PhoneMatrix() {
  const [role, setRole] = useState<Role>('responder');
  const { rows, foot } = roleRows(role);
  return (
    <div className="flex flex-col gap-3 md:hidden">
      <Select
        label="Role"
        options={MATRIX_ROLES.map((r) => ({
          value: r,
          label: r === 'client' ? 'Client · Phase 3' : ROLE_LABELS[r],
        }))}
        value={role}
        onChange={(e) => setRole(e.target.value as Role)}
      />
      <div className="rounded-aura-lg border border-border-default bg-bg-surface px-3.5 py-1">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex gap-2.5 border-b border-border-subtle py-2.5 text-sm leading-snug last:border-b-0"
          >
            <span
              className={
                r.cell === 'Y'
                  ? 'text-fg-positive'
                  : r.cell === 'N'
                    ? 'text-fg-tertiary'
                    : 'text-fg-secondary'
              }
            >
              {r.cell === 'N' ? (
                <IconMinus size="sm" aria-label="Not allowed" />
              ) : (
                <IconCheck size="sm" aria-label={r.cell === 'Y' ? 'Allowed' : 'Allowed with limits'} />
              )}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className={r.cell === 'N' ? 'text-fg-secondary' : ''}>{r.label}</span>
              {r.cell !== 'Y' && r.cell !== 'N' && (
                <span className="text-xs text-fg-secondary">{r.cell}</span>
              )}
            </span>
          </div>
        ))}
        <span className="block py-2 text-xs text-fg-secondary">{foot}</span>
      </div>
    </div>
  );
}

/** MUsers' people (§35.3): one card each in one rounded list; a tap opens the sheet. View only. */
function PeopleCards({ data, rows }: { data: UsersData; rows: UserRow[] }) {
  const [open, setOpen] = useState<UserRow | null>(null);
  const [last, setLast] = useState<UserRow | null>(null);
  if (open && open !== last) setLast(open);
  const shown = open ?? last;
  const facts = shown ? sheetFacts(data, shown) : [];
  return (
    <div className="flex flex-col gap-2 md:hidden">
      <span className="font-mono text-xs text-fg-tertiary">PEOPLE · {rows.length}</span>
      <div className="overflow-hidden rounded-aura-lg border border-border-default bg-bg-surface">
        {rows.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setOpen(r)}
            aria-label={`${r.name}, ${ROLE_LABELS[r.role]}, ${r.meta}. Show details`}
            className="flex min-h-16 w-full items-center gap-2.5 border-0 border-b border-border-subtle bg-transparent py-2.5 pr-2 pl-3.5 text-left last:border-b-0"
          >
            <span className="flex min-w-0 grow flex-col gap-0.5 leading-snug">
              <span className="flex items-center gap-2">
                <span className="font-semibold">{r.name}</span>
                <RoleBadge role={r.role} />
              </span>
              <span className="truncate text-xs text-fg-secondary">{r.sub}</span>
              <span className={`text-xs ${r.oncall.live ? 'font-semibold' : 'text-fg-secondary'}`}>
                {r.meta}
              </span>
            </span>
            <IconChevronRight size="sm" aria-hidden className="text-fg-tertiary" />
          </button>
        ))}
      </div>
      <Dialog
        open={!!open}
        onClose={() => setOpen(null)}
        size="sm"
        title={shown?.name ?? ''}
        description={shown ? `${ROLE_LABELS[shown.role]} · ${shown.sub}` : undefined}
      >
        <div className="flex flex-col gap-3">
          {facts.map((f) => (
            <div key={f.k} className="flex flex-col gap-0.5 text-sm leading-snug">
              <span className="text-xs text-fg-secondary">{f.k}</span>
              <span>{f.v}</span>
            </div>
          ))}
          <span className="flex gap-1.5 text-xs text-fg-secondary">
            <IconEye size="sm" aria-hidden className="mt-0.5" />
            Roles and reassignments change on a larger screen.
          </span>
          <Button variant="secondary" fullWidth onClick={() => setOpen(null)}>
            Close
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
