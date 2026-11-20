import { describe, expect, it } from 'vitest';
import { checkingLine, checkWords, phraseGroups, removeWords, snippetOf, type PhraseCheck } from './phrases';

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

describe('the groups (board OrganisationLists)', () => {
  it('lists the five groups in the board’s order, each with a count and its phrases’ language', () => {
    const groups = phraseGroups([
      { id: id(1), group: 'gambling_en', phrase: 'slot online' },
      { id: id(2), group: 'gambling_th', phrase: 'บาคาร่า' },
      { id: id(3), group: 'gambling_th', phrase: 'แทงบอล' },
    ]);
    expect(groups.map((g) => [g.label, g.count])).toEqual([
      ['Gambling · Thai', '2 phrases'],
      ['Gambling · English', '1 phrase'],
      ['Brands', '0 phrases'],
      ['Adult', '0 phrases'],
      ['Pharma', '0 phrases'],
    ]);
    expect(groups[0]!.phrases.map((p) => p.lang)).toEqual(['th', 'th']);
    expect(groups[1]!.phrases[0]!.lang).toBe('en');
  });
});

const check = (over: Partial<PhraseCheck> = {}): PhraseCheck => ({
  sites: 17,
  checked: 17,
  unchecked: [],
  found: 0,
  hits: [],
  ...over,
});

describe('the check’s words (D-069: it counts what was checked)', () => {
  it('found on a site: whose page, the snippet with the match, and when it was fetched', () => {
    const words = checkWords(
      check({
        hits: [
          {
            site: 'MuvMi',
            view: 'plain',
            checkedAt: '2026-09-25T02:30:00Z',
            snippet: 'a href="/app">ดาวน์โหลดแอป รับเครดิตฟรี 50 บาท</a><p>สำหรับเที่ยวแรก',
          },
        ],
      }),
      'เครดิตฟรี',
    );
    expect(words).toMatchObject({
      kind: 'found',
      title: 'Found on MuvMi’s home page — this would open a PROBLEM on a healthy site',
      snippet: { before: 'ดาวน์โหลดแอป รับ', match: 'เครดิตฟรี', after: ' 50 บาท สำหรับเที่ยวแรก' },
      line: 'Last clean fetch of 17 sites · MuvMi, Fri 25 Sep 09:30. Make the phrase longer so it only matches spam.',
    });
  });

  it('found on several sites says how many more', () => {
    const hit = { site: 'MuvMi', view: 'plain', checkedAt: '2026-09-25T02:30:00Z', snippet: 'x y' };
    expect(checkWords(check({ found: 3, hits: [hit] }), 'x y')).toMatchObject({
      title: 'Found on MuvMi’s home page and 2 more sites — this would open a PROBLEM on a healthy site',
    });
  });

  it('clear on every site', () => {
    expect(checkWords(check(), 'slot vip room')).toMatchObject({
      kind: 'clear',
      title: 'Not found on any of the 17 sites’ last clean fetch',
    });
  });

  it('clear on the sites it could check, naming the ones it couldn’t', () => {
    const words = checkWords(check({ checked: 15, unchecked: ['BA China', 'Cando Asia'] }), 'slot vip room');
    expect(words).toMatchObject({
      kind: 'partial',
      title: 'Not found on the 15 of 17 sites with a clean fetch',
      lines: [
        expect.stringMatching(/^Not checked \(no clean fetch yet\): BA China, Cando Asia\.$/),
        expect.any(String),
      ],
    });
  });

  it('nothing to check yet says so', () => {
    expect(checkWords(check({ checked: 0 }), 'x y').kind).toBe('partial');
    expect((checkWords(check({ checked: 0 }), 'x y') as { title: string }).title).toBe(
      'No site has a clean fetch yet — nothing was checked',
    );
  });

  it('one site reads in the singular', () => {
    expect(checkWords(check({ sites: 1, checked: 1 }), 'x y')).toMatchObject({
      title: 'Not found on the site’s last clean fetch',
    });
  });
});

describe('the snippet (lower-case page source shown as text)', () => {
  it('drops tags, a tag cut at either end, and keeps 60 characters each side', () => {
    const s = snippetOf(`ss="x">${'a'.repeat(70)} slot vip room ${'b'.repeat(70)}<sp`, 'Slot  VIP room');
    expect(s.match).toBe('slot vip room');
    expect(s.before.startsWith('… ')).toBe(true);
    expect(s.after.endsWith(' …')).toBe(true);
    expect(`${s.before}${s.after}`).not.toMatch(/[<>]/u);
  });
});

describe('the snippet keeps text that has a “>” in it', () => {
  it('plain text before a “>” is not a cut tag', () => {
    expect(snippetOf('rooms > 5 · pick a time slot today', 'time slot')).toMatchObject({
      before: 'rooms > 5 · pick a ',
      match: 'time slot',
    });
  });
});

describe('the checking line', () => {
  it('counts the live sites, one in the singular', () => {
    expect(checkingLine(17)).toBe('Checking 17 sites’ last clean fetch…');
    expect(checkingLine(1)).toBe('Checking the site’s last clean fetch…');
  });
});

describe('remove', () => {
  it('names the group and what happens to an incident it opened', () => {
    expect(removeWords('gambling_th')).toEqual({
      description: 'From Gambling · Thai · sites stop being checked for it from the next round.',
      body: 'The Googlebot and Google-search views stop at the next crawler run (within 30 min). An incident it opened recovers once no check finds it and stays open until it’s resolved — a short, unacknowledged one resolves itself.',
    });
  });
});
