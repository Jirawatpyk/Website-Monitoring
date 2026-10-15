import { FINGERPRINT_LIMITS } from '@dxt/shared';
import { describe, expect, it } from 'vitest';
import { fingerprintBuilder } from './fingerprint';

const build = (html: string, url = 'https://www.example.co.th/th/') => {
  const b = fingerprintBuilder(url);
  b.write(html);
  return b.end();
};

describe('fingerprintBuilder (S09d, D-046)', () => {
  it('reads the head fields, the first h1 and the domains', () => {
    expect(
      build(`<!doctype html><html><head>
        <title>  Bangkok Airways –
          Taiwan </title>
        <meta name="Description" content="Fly to Taipei &amp; back">
        <meta name="robots" content="INDEX, Follow">
        <link rel="alternate canonical" href="/th/home">
        <script src="https://static.cdn.example.com/app.js"></script>
        <script>var x = '<a href="https://not-a-link.example">';</script>
      </head><body>
        <h1>Welcome to <span>Taiwan</span></h1><h1>Second</h1>
        <iframe src="//maps-embed.example/x"></iframe>
        <a href="/about">About</a><a href="https://booking.example.co.th/b">Book</a>
        <a href="mailto:x@example.com">Mail</a><a href="javascript:void(0)">x</a>
      </body></html>`),
    ).toEqual({
      title: 'Bangkok Airways – Taiwan',
      description: 'Fly to Taipei & back',
      robots: 'index, follow',
      canonical: 'https://www.example.co.th/th/home',
      h1: 'Welcome to Taiwan',
      scripts: ['example.com', 'maps-embed.example'],
      links: ['example.co.th'],
    });
  });

  it('keeps the first of each, and null for what the page lacks', () => {
    expect(
      build(
        '<title>A</title><title>B</title><meta name="description" content="one"><meta name="description" content="two">',
      ),
    ).toEqual({
      title: 'A',
      description: 'one',
      robots: null,
      canonical: null,
      h1: null,
      scripts: [],
      links: [],
    });
  });

  it('reads the same page the same, however the text is cut into chunks', () => {
    const html =
      '<title>Site</title><h1>Hello <b>world</b></h1><script src="https://evil-cdn.example/x.js"></script>' +
      '<a href="https://casino.example/">x</a>';
    const b = fingerprintBuilder('https://site.example/');
    for (const ch of html) b.write(ch);
    expect(b.end()).toEqual(build(html, 'https://site.example/'));
  });

  it('caps texts and domain sets', () => {
    const many = Array.from(
      { length: 250 },
      (_, i) => `<a href="https://d${String(i).padStart(3, '0')}.example/">x</a>`,
    );
    const fp = build(`<title>${'t'.repeat(1000)}</title>${many.join('')}`);
    expect(fp.title).toHaveLength(FINGERPRINT_LIMITS.text);
    expect(fp.links).toHaveLength(FINGERPRINT_LIMITS.domains);
    expect(fp.links[0]).toBe('d000.example');
  });

  it('closes a title or h1 the page never closed', () => {
    expect(build('<title>Cut off').title).toBe('Cut off');
    expect(build('<h1>Open heading').h1).toBe('Open heading');
  });
});
