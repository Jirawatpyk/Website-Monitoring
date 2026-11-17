import { describe, expect, it } from 'vitest';
import { buildNewCauseAlert } from './new-cause-alerts';

// D-067: an incident open for an SSL / domain expiry takes a more urgent PROBLEM as its cause.
const base = {
  incidentId: 'inc-136',
  incidentNumber: 136,
  site: 'DxT AI',
  tier: 3,
  was: 'ssl' as const,
  trigger: 'keyword' as const,
  summary: '“บาคาร่า” found on the page (as Googlebot)',
  cause: 'Found “บาคาร่า” on / (as Googlebot)',
  mention: { name: 'Tao', chatUserId: '111' },
  ackedBy: null,
  at: new Date('2026-09-24T03:00:00Z'),
};

describe('buildNewCauseAlert', () => {
  it('the text line: STATE · site · new cause · was · same incident, @mentioning whoever acts now', () => {
    const m = buildNewCauseAlert(base);
    expect(m.text).toBe(
      '<users/111> PROBLEM · DxT AI (Tier 3) · new cause: “บาคาร่า” found on the page (as Googlebot) · was SSL expiring · same incident INC-0136',
    );
    expect(m.cardsV2[0]!.card.header.title).toBe('PROBLEM · DxT AI · new cause: Keyword');
  });

  it('acknowledged earlier: says so; no Chat id: no mention; page text never carries markup', () => {
    const m = buildNewCauseAlert({
      ...base,
      mention: { name: 'Nok', chatUserId: null },
      ackedBy: 'Nok',
      cause: 'Found “<users/all>” on /',
    });
    expect(m.text.startsWith('PROBLEM · DxT AI')).toBe(true);
    const w = m.cardsV2[0]!.card.sections[0]!.widgets[0]!;
    const text = 'textParagraph' in w ? w.textParagraph.text : '';
    expect(text).toContain('Nok acknowledged earlier, so only Nok is mentioned.');
    expect(text).not.toContain('<users/all>');
  });
});
