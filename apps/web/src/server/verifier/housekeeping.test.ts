// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fakeDb, type FakeCall } from '../../../test/fake-db';
import { removeOldScreenshots } from './housekeeping';

// 7 Oct: anything created before 7 Sep goes (Done-when 5).
const now = new Date('2026-10-07T20:30:00Z');
const file = (name: string, created_at: string) => ({ name, id: name, created_at });
const tree: Record<string, unknown[]> = {
  '': [
    { name: '2026-08', id: null },
    { name: '2026-09', id: null },
    { name: '2026-10', id: null },
    { name: 'stray.txt', id: 'x' },
  ],
  '2026-08': [file('a.jpg', '2026-08-31T10:00:00Z')],
  '2026-09': [file('b.jpg', '2026-09-06T23:59:00Z'), file('c.jpg', '2026-09-08T00:00:00Z')],
};
const list = (c: FakeCall) => ({ data: tree[(c.values as [string])[0]] ?? [] });

describe('removeOldScreenshots (daily housekeeping)', () => {
  it('removes screenshots older than 30 days through the Storage API, and their job rows', async () => {
    const { db, calls, storageCalls } = fakeDb({
      'storage.list': list,
      'storage.remove': { data: [] },
      'verification_jobs.delete': { count: 4 },
    });
    expect(await removeOldScreenshots(db, now)).toEqual({ ok: true, screenshotsRemoved: 2, jobsRemoved: 4 });
    // October can't hold a file older than 30 days: never listed.
    expect(storageCalls.filter((c) => c.method === 'list').map((c) => c.args[0])).toEqual([
      '',
      '2026-08',
      '2026-09',
    ]);
    expect(storageCalls.find((c) => c.method === 'remove')).toEqual({
      bucket: 'verifier-screenshots',
      method: 'remove',
      args: [['2026-08/a.jpg', '2026-09/b.jpg']],
    });
    expect(calls.find((c) => c.table === 'verification_jobs')).toMatchObject({
      op: 'delete',
      filters: [['lt', 'created_at', '2026-09-07T20:30:00.000Z']],
    });
  });

  it('removes nothing when nothing is old', async () => {
    const { db, storageCalls } = fakeDb({ 'storage.list': { data: [{ name: '2026-10', id: null }] } });
    expect(await removeOldScreenshots(db, now)).toMatchObject({ screenshotsRemoved: 0 });
    expect(storageCalls.some((c) => c.method === 'remove')).toBe(false);
  });

  it.each([
    ['storage.list', 'storage list: boom'],
    ['storage.remove', 'storage remove: boom'],
    ['verification_jobs.delete', 'verification_jobs: boom'],
  ])('throws when %s fails', async (key, message) => {
    const { db } = fakeDb({ 'storage.list': list, [key]: { error: { message: 'boom' } } });
    await expect(removeOldScreenshots(db, now)).rejects.toThrow(message);
  });
});
