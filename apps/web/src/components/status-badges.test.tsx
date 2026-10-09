import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  IconArrowUpRight,
  IconBan,
  IconCheck,
  IconCircleCheck,
  IconClock,
  IconEye,
  IconFileText,
  IconPencil,
  IconTriangleAlert,
} from '@jirawatpyk/aura-react/icons';
import type { IncidentState } from '@dxt/shared';
import { SeverityBadge, WorkflowBadge } from './status-badges';

/** The badge's tone, variant, icon and words as rendered. */
function badgeOf(el: ReactElement) {
  const { container } = render(el);
  const badge = container.querySelector('.aura-badge')!;
  const tone = [...badge.classList].find((c) => c.startsWith('aura-badge--'))!.replace('aura-badge--', '');
  const variant = [...badge.classList].find((c) => c.startsWith('is-'))?.replace('is-', '') ?? 'soft';
  return { tone, variant, icon: badge.querySelector('svg')?.innerHTML ?? null, text: badge.textContent };
}
const iconOf = (icon: ReactElement) => render(icon).container.querySelector('svg')!.innerHTML;

// Done-when 2 (S07): every incident state renders the exact badge of spec §11 / §14.3 — workflow
// states never solid red, never the ban icon.
describe('WorkflowBadge — one per state (spec §11, §14.3)', () => {
  it.each<[IncidentState, number | undefined, string, string, ReactElement | null, string]>([
    ['unacked', undefined, 'danger', 'outline', <IconClock key="i" />, 'Unacked'],
    ['escalated', 1, 'warning', 'outline', <IconArrowUpRight key="i" />, 'Escalated · L1'],
    ['acknowledged', undefined, 'neutral', 'outline', <IconCheck key="i" />, 'Acknowledged'],
    ['monitoring', undefined, 'neutral', 'outline', <IconEye key="i" />, 'Monitoring'],
    ['needs_root_cause', undefined, 'warning', 'outline', <IconPencil key="i" />, 'Needs root cause'],
    ['resolved', undefined, 'success', 'outline', <IconCircleCheck key="i" />, 'Resolved'],
    ['in_review', undefined, 'neutral', 'outline', <IconFileText key="i" />, 'In review'],
    ['closed', undefined, 'neutral', 'soft', null, 'Closed'],
  ])('%s', (state, level, tone, variant, icon, text) => {
    const b = badgeOf(<WorkflowBadge state={state} level={level} />);
    expect(b).toEqual({ tone, variant, icon: icon ? iconOf(icon) : null, text });
    expect(b.variant).not.toBe('solid');
    expect(b.icon).not.toBe(iconOf(<IconBan />));
  });
});

describe('SeverityBadge (spec §11; recovered = outline, "Was …" as the boards)', () => {
  it.each<['down' | 'problem', boolean, string, string, ReactElement, string]>([
    ['down', false, 'danger', 'solid', <IconBan key="i" />, 'Down'],
    ['problem', false, 'warning', 'soft', <IconTriangleAlert key="i" />, 'Problem'],
    ['down', true, 'danger', 'outline', <IconBan key="i" />, 'Was down'],
    ['problem', true, 'warning', 'outline', <IconTriangleAlert key="i" />, 'Was problem'],
  ])('%s recovered=%s', (severity, recovered, tone, variant, icon, text) => {
    expect(badgeOf(<SeverityBadge severity={severity} recovered={recovered} />)).toEqual({
      tone,
      variant,
      icon: iconOf(icon),
      text,
    });
  });
});
