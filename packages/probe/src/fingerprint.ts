import { FINGERPRINT_LIMITS, registrableDomain, type PageFingerprint } from '@dxt/shared';
import { Parser } from 'htmlparser2';

/**
 * Builds a page's fingerprint (S09d, D-046) from its decoded text, chunk by chunk, as `readBody`
 * streams it: htmlparser2's tokenizer keeps a tag split across two chunks, so nothing is buffered
 * beyond the parser's own state. It only reads tokens — no script runs, no URL is fetched.
 *
 * - title: the first `<title>`; description / robots: the first `<meta name>` of each; canonical:
 *   the first `<link rel="canonical">`, resolved against the page's URL; h1: the first `<h1>`'s text.
 * - scripts: the registrable domains of `script[src]` and `iframe[src]`; links: of `a[href]`.
 *
 * Texts are trimmed with whitespace collapsed and cut at FINGERPRINT_LIMITS.text; each domain set is
 * sorted and cut at FINGERPRINT_LIMITS.domains.
 */
export function fingerprintBuilder(pageUrl: string) {
  const base = safeUrl(pageUrl);
  const fp = {
    title: null as string | null,
    description: null as string | null,
    robots: null as string | null,
    canonical: null as string | null,
    h1: null as string | null,
  };
  const scripts = new Set<string>();
  const links = new Set<string>();
  // Text being collected for the first <title> / <h1>; null when not inside one.
  let titleText: string | null = null;
  let h1Text: string | null = null;
  let h1Depth = 0;

  const domainOf = (value: string | undefined): string | null => {
    if (!value || !base) return null;
    const u = safeUrl(value.trim(), base);
    if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:')) return null;
    return registrableDomain(u.hostname);
  };
  const add = (set: Set<string>, value: string | undefined) => {
    const d = domainOf(value);
    if (d) set.add(d);
  };

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        switch (name) {
          case 'title':
            if (fp.title === null && titleText === null) titleText = '';
            break;
          case 'h1':
            if (fp.h1 === null) {
              h1Depth += 1;
              if (h1Text === null) h1Text = '';
            }
            break;
          case 'meta': {
            const key = (attrs.name ?? '').trim().toLowerCase();
            if (key === 'description' && fp.description === null) fp.description = clean(attrs.content);
            if (key === 'robots' && fp.robots === null)
              fp.robots = clean(attrs.content)?.toLowerCase() ?? null;
            break;
          }
          case 'link': {
            const rel = (attrs.rel ?? '').toLowerCase().split(/\s+/);
            if (rel.includes('canonical') && fp.canonical === null && attrs.href) {
              // Only a web address: a `javascript:` / `data:` value never reaches a page as a link.
              const u = base ? safeUrl(attrs.href.trim(), base) : null;
              fp.canonical = u && (u.protocol === 'http:' || u.protocol === 'https:') ? clean(u.href) : null;
            }
            break;
          }
          case 'script':
          case 'iframe':
            add(scripts, attrs.src);
            break;
          case 'a':
            add(links, attrs.href);
            break;
        }
      },
      ontext(text) {
        if (titleText !== null && titleText.length < 4 * FINGERPRINT_LIMITS.text) titleText += text;
        if (h1Text !== null && h1Text.length < 4 * FINGERPRINT_LIMITS.text) h1Text += text;
      },
      onclosetag(name) {
        if (name === 'title' && titleText !== null) {
          fp.title = clean(titleText);
          titleText = null;
        }
        if (name === 'h1' && h1Text !== null) {
          h1Depth -= 1;
          if (h1Depth <= 0) {
            fp.h1 = clean(h1Text) ?? '';
            h1Text = null;
          }
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );

  return {
    write(text: string) {
      parser.write(text);
    },
    /** Ends the parse (closing what is still open) and returns the fingerprint. */
    end(): PageFingerprint {
      parser.end();
      if (titleText !== null) fp.title = clean(titleText);
      if (h1Text !== null) fp.h1 = clean(h1Text);
      const sorted = (set: Set<string>) => [...set].sort().slice(0, FINGERPRINT_LIMITS.domains);
      const out = { ...fp, h1: fp.h1 || null, scripts: sorted(scripts), links: sorted(links) };
      // Long made-up domains could still pass the 32 KB the database takes (security review): drop link
      // domains, then script domains, from the end until it fits — what's left of them are new anyway.
      while (bytes(out) > FINGERPRINT_LIMITS.bytes && (out.links.length || out.scripts.length)) {
        if (out.links.length) out.links.pop();
        else out.scripts.pop();
      }
      return out;
    },
  };
}

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

/** Trimmed, whitespace collapsed, cut at the text limit; empty → null. */
function clean(value: string | undefined | null): string | null {
  if (value == null) return null;
  const t = value.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, FINGERPRINT_LIMITS.text) : null;
}

function safeUrl(value: string, base?: URL): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}
