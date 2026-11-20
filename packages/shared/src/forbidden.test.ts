import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN_BRANDS,
  FORBIDDEN_GROUP_IDS,
  FORBIDDEN_GROUPS,
  FORBIDDEN_PHRASES,
  MAX_PHRASE_LENGTH,
  findForbiddenPhrases,
  findInNormalized,
  isShortPhrase,
  phraseRefusal,
  cleanPhrase,
  longestPhrase,
  normalizeForMatch,
} from './forbidden';

// D-041 / D-042: the shared forbidden list — phrases, case-insensitive, whitespace-tolerant.
describe('findForbiddenPhrases', () => {
  it.each([
    ['a shared phrase in the body', '<a href="x">สล็อตออนไลน์ เว็บตรง</a>', ['สล็อตออนไลน์']],
    ['two phrases, in list order', 'แทงบอล ... บาคาร่า', ['บาคาร่า', 'แทงบอล']],
    ['English, any case', '<p>Best SLOT Online 2026</p>', ['slot online']],
    ['a run of spaces and a newline', 'slot   \n online', ['slot online']],
    ['&nbsp; between the words', 'slot&nbsp;online', ['slot online']],
    ['U+00A0 between the words', 'slot online', ['slot online']],
    ['a brand', 'Join UFABET today', ['ufabet']],
    ['a clean page', '<h1>Welcome to our hotel</h1>', []],
    ['"time slot" on a booking page', 'Select a time slot for your visit', []],
    ['"slot" alone', 'Book a slot · Slots available', []],
    ['"casino" alone (a hotel casino floor)', 'Casino floor open 24 h', []],
  ])('%s', (_name, text, found) => {
    expect(findForbiddenPhrases(text)).toEqual(found);
  });

  it('takes another list', () => {
    expect(findForbiddenPhrases('A B', ['a b', 'c'])).toEqual(['a b']);
  });
});

/**
 * Thai has no spaces between words, so a Thai entry can match inside a longer, harmless word.
 * Handwritten copy of the kind our sites carry (hotel, airline, booking, news) — no real page content.
 */
const NORMAL_THAI = [
  'กรุณาเลือกช่วงเวลาที่ต้องการจอง',
  'เลือกสล็อตเวลาที่ต้องการ แล้วกดยืนยันการจอง',
  'จองห้องพักออนไลน์ ราคาพิเศษสำหรับสมาชิก',
  'เที่ยวบินตรงกรุงเทพฯ – สมุย ทุกวัน',
  'การพนันเป็นสิ่งผิดกฎหมาย ทางโรงแรมขอสงวนสิทธิ์',
  'ตรวจผลสลากกินแบ่งรัฐบาลงวดล่าสุด',
  'ข่าวกีฬา ฟุตบอลไทยลีก ผลการแข่งขันล่าสุด',
  'ชำระเงินผ่านบัตรเครดิต ฟรีค่าธรรมเนียม',
  'ดาวน์โหลดแอปบนเว็บไซต์ของเรา ฝากข้อความถึงเรา',
  'ร้านอาหารเปิดให้บริการ คลิปวิดีโอแนะนำโรงแรม',
  'หนังสือพิมพ์ออนไลน์ อ่านข่าวหวยกับรัฐบาล',
];

describe('the shared list against normal Thai copy', () => {
  it.each(NORMAL_THAI)('no hit in "%s"', (text) => {
    expect(findForbiddenPhrases(text)).toEqual([]);
  });
});

describe('the list itself', () => {
  it('holds phrases: every Latin entry has a space or is a brand', () => {
    const latin = FORBIDDEN_PHRASES.filter((p) => /^[\x20-\x7e]+$/.test(p));
    for (const p of latin) {
      expect(p.includes(' ') || (FORBIDDEN_BRANDS as readonly string[]).includes(p), p).toBe(true);
    }
  });

  it('has no duplicates and is already normalised', () => {
    expect(new Set(FORBIDDEN_PHRASES).size).toBe(FORBIDDEN_PHRASES.length);
    for (const p of FORBIDDEN_PHRASES) expect(normalizeForMatch(p)).toBe(p);
  });

  it('is the groups in order, each entry within the stored length', () => {
    expect(FORBIDDEN_PHRASES).toEqual(FORBIDDEN_GROUP_IDS.flatMap((g) => FORBIDDEN_GROUPS[g]));
    expect(longestPhrase(FORBIDDEN_PHRASES)).toBeLessThanOrEqual(MAX_PHRASE_LENGTH);
  });
});

describe('the phrase rules for an Admin’s new phrase (spec §41 item 5, D-069)', () => {
  it.each([
    ['slot', 'short'],
    ['Slot', 'short'],
    ['casino', null], // 6 letters: a word that long is allowed (the Admin's call)
    ['ufa365', null], // a 6-letter brand passes
    ['ufabet', 'taken'],
    ['joker388', null],
    ['พนัน', 'short'], // 3 Thai characters: the vowel mark ั doesn't count
    ['สล็อต', null], // ส ล อ ต: 4
    ['หวย', 'short'],
    ['time slot', null],
    ['  slot   gacor ', 'taken'],
    ['SLOT ONLINE', 'taken'],
    ['', 'empty'],
    ['   ', 'empty'],
    ['a b'.repeat(21), 'too_long'],
  ])('“%s” → %s', (phrase, refusal) => {
    expect(phraseRefusal(phrase, FORBIDDEN_PHRASES)).toBe(refusal);
  });

  it('every seeded phrase passes the short-word rule', () => {
    for (const p of FORBIDDEN_PHRASES) expect(isShortPhrase(p), p).toBe(false);
  });

  it('counts characters as the table does, not UTF-16 units (an emoji is one)', () => {
    expect(phraseRefusal('🎰'.repeat(40), [])).toBeNull();
    expect(phraseRefusal('🎰'.repeat(61), [])).toBe('too_long');
  });

  it('stores a phrase trimmed, its spaces as one', () => {
    expect(cleanPhrase('  slot \t  vip ')).toBe('slot vip');
  });
});

describe('a list from the database (D-069)', () => {
  it('the longest entry sets the stream overlap; an empty list has none', () => {
    expect(longestPhrase(['ab', 'abcd'])).toBe(4);
    expect(longestPhrase([])).toBe(0);
  });

  it('an entry that normalises to nothing never matches', () => {
    expect(findForbiddenPhrases('anything at all', ['', '   ', 'at all'])).toEqual(['at all']);
  });

  it('a stored page is matched as stored', () => {
    const page = normalizeForMatch('<p>Best SLOT&nbsp;Online</p>');
    expect(findInNormalized(page, ['slot online', 'judi online'])).toEqual(['slot online']);
  });
});
