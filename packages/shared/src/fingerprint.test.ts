import { describe, expect, it } from 'vitest';
import {
  FINGERPRINT_FIELDS,
  FINGERPRINT_LABELS,
  pageFingerprintSchema,
  registrableDomain,
} from './fingerprint';

describe('registrableDomain (D-046 item 7)', () => {
  it.each([
    ['www.bangkokair.com', 'bangkokair.com'],
    ['d123abc.cloudfront.net', 'cloudfront.net'],
    ['WWW.Example.CO.TH.', 'example.co.th'],
    ['shop.example.com.tw', 'example.com.tw'],
    ['example.com', 'example.com'],
    ['localhost', 'localhost'],
    ['203.0.113.7', '203.0.113.7'],
    ['bad host', null],
    ['', null],
  ])('%s → %s', (host, domain) => {
    expect(registrableDomain(host)).toBe(domain);
  });
});

describe('pageFingerprintSchema', () => {
  it('reads a stored fingerprint and fills what is missing', () => {
    expect(pageFingerprintSchema.parse({ title: 'A', scripts: ['x.example'] })).toEqual({
      title: 'A',
      description: null,
      robots: null,
      canonical: null,
      h1: null,
      scripts: ['x.example'],
      links: [],
    });
  });

  it('turns a malformed field into nothing rather than failing', () => {
    expect(pageFingerprintSchema.parse({ title: 42, links: 'nope' })).toMatchObject({
      title: null,
      links: [],
    });
  });

  it('labels every field in the card order', () => {
    expect(FINGERPRINT_FIELDS.map((f) => FINGERPRINT_LABELS[f])).toEqual([
      'Page title',
      'Meta description',
      'Robots',
      'Canonical URL',
      'Main heading (first h1)',
      'Script / iframe domains',
      'Link domains',
    ]);
  });
});
