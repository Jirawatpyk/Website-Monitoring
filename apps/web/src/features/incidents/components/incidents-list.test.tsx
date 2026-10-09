import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ListIncident } from '../model';
import { IncidentsList } from './incidents-list';

// Fixtures from the Incidents board (test data only, §21.11).
const NOW = '2026-09-25T03:07:00Z';
const at = (local: string) => new Date(`2026-09-${local}+07:00`).toISOString();
const base: ListIncident = {
  id: 'i142',
  number: 142,
  siteId: 's-muvmi',
  siteName: 'MuvMi',
  tier: 1,
  severity: 'down',
  trigger: 'hard_fail',
  state: 'unacked',
  escalationLevel: 0,
  startedAt: at('25T09:48:12'),
  downStartedAt: null,
  detectedAt: at('25T09:48:41'),
  ackedAt: null,
  ackedByName: null,
  recoveredAt: null,
  resolvedAt: null,
  autoResolved: false,
  isFlapping: false,
  isManual: false,
  ownerName: 'Arm',
  rootCauseCategory: null,
  rootCause: null,
  rootCauseFix: null,
};
const incidents: ListIncident[] = [
  base,
  {
    ...base,
    id: 'i138',
    number: 138,
    siteId: 's-tubtong',
    siteName: 'Tubtong',
    severity: 'problem',
    state: 'resolved',
    recoveredAt: at('24T14:14:00'),
    resolvedAt: at('24T14:30:00'),
    rootCauseFix: 'Verifier restarted',
  },
  {
    ...base,
    id: 'a1',
    number: 150,
    severity: 'problem',
    state: 'resolved',
    autoResolved: true,
    startedAt: at('24T03:00:00'),
  },
];
const sites = [
  { id: 's-muvmi', name: 'MuvMi' },
  { id: 's-tubtong', name: 'Tubtong' },
];
const show = (initialView?: 'unacked') =>
  render(<IncidentsList incidents={incidents} sites={sites} nowIso={NOW} initialView={initialView} />);

describe('Incidents list (Incidents, MIncidents, D-033)', () => {
  it('KPIs: Unacked (not "Escalated, not acked" until S08) and MTTA / MTTR wait for 3 DOWN incidents', () => {
    show();
    expect(screen.getAllByText('Unacked').length).toBeGreaterThan(0);
    expect(screen.queryByText('Escalated, not acked')).toBeNull();
    expect(screen.getAllByText('Not enough incidents yet')).toHaveLength(2);
  });

  it('Needs action by default; Resolved & closed shows the done ones and the hidden note', () => {
    show();
    const table = screen.getByRole('grid', { name: 'Incidents' });
    expect(within(table).getByText('INC-0142')).toBeInTheDocument();
    expect(within(table).queryByText('INC-0138')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Resolved & closed · 1' }));
    expect(within(screen.getByRole('grid', { name: 'Incidents' })).getByText('INC-0138')).toBeInTheDocument();
    expect(
      screen.getByText(/1 shown · 1 short PROBLEM auto-resolved in < 5 min is hidden\./),
    ).toBeInTheDocument();
  });

  it('Export CSV carries the filters', () => {
    show();
    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute(
      'href',
      '/incidents/incidents.csv?view=needs_action&severity=all&period=30',
    );
  });

  it('phone: the Overview card’s ?view=unacked opens on Unacked; an unacked DOWN card offers Acknowledge', () => {
    show('unacked');
    expect(screen.getByRole('radio', { name: 'Unacked 1' })).toBeChecked();
    expect(screen.getByText('1 not acknowledged')).toBeInTheDocument();
    const card = screen.getAllByRole('link').find((a) => a.textContent?.includes('Acknowledge'))!;
    expect(card).toHaveAttribute('href', '/incidents/i142');
  });
});
