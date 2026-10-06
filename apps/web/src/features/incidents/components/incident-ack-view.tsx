import { IconUser } from '@jirawatpyk/aura-react/icons';
import { SeverityBadge, WorkflowBadge } from '@/components/status-badges';
import { NoAccess } from '@/components/states';
import type { IncidentView } from '../view';
import { AckPanel } from './ack-panel';

interface IncidentAckViewProps {
  view: IncidentView;
  viewerName: string;
  viewerEmail: string;
}

/**
 * MobileAck / MobileAckDark (docs/design/screens.md): the incident a Chat card or email links to,
 * ready to acknowledge in one tap. One column at every width until S07 builds the full Incident
 * board here (D-016); escalation, client update and notes join with their slices.
 */
export function IncidentAckView({ view, viewerName, viewerEmail }: IncidentAckViewProps) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-2.5 lg:min-h-full">
      <div className="flex items-center gap-2">
        <SeverityBadge severity={view.severity} recovered={view.recovered} />
        <WorkflowBadge state={view.state} level={view.escalationLevel} />
        <span className="ml-auto font-mono text-xs text-fg-secondary">{view.id}</span>
      </div>

      <header className="flex flex-col gap-1.5">
        <h1 className="m-0 font-display text-3xl leading-tight font-semibold">{view.title}</h1>
        <span className="text-sm text-fg-secondary">{view.sub}</span>
        {view.role && (
          <span className="flex items-center gap-2 text-sm">
            <span className="flex text-fg-secondary">
              <IconUser aria-hidden className="size-4" />
            </span>
            <b className="font-semibold">{view.role}</b>
          </span>
        )}
      </header>

      <dl className="aura-card m-0 flex flex-col gap-0 px-4 py-1">
        <div className="flex items-baseline justify-between gap-3 border-b border-border-subtle py-2">
          <dt className="text-sm text-fg-secondary">Confirmed down</dt>
          <dd className="m-0 flex flex-col items-end leading-snug">
            <span className="font-medium tabular-nums">{view.confirmedAt}</span>
            <span className="text-xs text-fg-secondary">{view.confirmedBy}</span>
          </dd>
        </div>
        <div className="flex flex-col gap-0.5 py-2 leading-snug">
          <dt className="text-sm text-fg-secondary">Cause</dt>
          <dd className="m-0 font-medium">{view.cause}</dd>
        </div>
      </dl>

      {view.ack.kind === 'read-only' && (
        <NoAccess title={view.ack.title} description={view.ack.description} people={view.ack.people} />
      )}

      <AckPanel
        incidentId={view.incidentId}
        ack={view.ack}
        viewerName={viewerName}
        viewerEmail={viewerEmail}
        siteUrl={view.siteUrl}
      >
        {view.log.length > 0 && (
          <section aria-label="Latest" className="flex flex-col">
            <span className="pb-0.5 font-mono text-xs text-fg-tertiary">LATEST</span>
            <ol className="m-0 flex list-none flex-col p-0">
              {view.log.map((l, n) => (
                <li key={`${l.at}-${n}`} className="flex gap-3 py-1 leading-snug">
                  <span className="w-10 shrink-0 pt-px font-mono text-xs text-fg-secondary">{l.at}</span>
                  <span className="text-sm">{l.text}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </AckPanel>
    </div>
  );
}
