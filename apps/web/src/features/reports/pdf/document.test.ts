import { describe, expect, it } from 'vitest';
import type { PdfModel } from '../words';
import { esc, reportDocument } from './document';

// The PDF page is a string template, so escaping is the one defence (security review, S20).
const model: PdfModel = {
  title: 'T',
  eyebrow: 'E',
  client: '<script>alert(1)</script>',
  meta: 'A & B',
  tiles: [{ label: 'L', value: '"v"', caption: "c'" }],
  sites: [
    { name: '<img src=x>', uptime: '100.00%', days: [{ kind: 'ok', maintenance: true, label: '"><b>' }] },
  ],
  table: [{ name: '<i>', uptime: '1', down: '2', p50: '3', p95: '4', incidents: '5' }],
  incidents: [
    {
      date: '1 Sep',
      time: '10:00',
      kind: 'outage',
      kindWord: 'Outage',
      duration: '5 min',
      line: 'x',
      cause: '</td><script>',
    },
  ],
  measure: 'm',
  footer: 'f',
  header: 'h',
};

describe('reportDocument', () => {
  it('escapes every value; no tag from the data survives', () => {
    const html = reportDocument(model, '');
    expect(html).not.toMatch(/<script|<img|<td><i>/);
    expect(html).toContain('aria-label="&quot;&gt;&lt;b&gt;"');
    expect(html).toContain('<td>&lt;i&gt;</td>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;&gt;&lt;b&gt;');
    expect(html).toContain('A &amp; B');
  });
  it('an empty month says so', () => {
    expect(reportDocument({ ...model, incidents: [] }, '')).toContain(
      'No outages or degraded service this month.',
    );
  });
  it('esc', () => {
    expect(esc(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    expect(esc(3)).toBe('3');
  });
});
