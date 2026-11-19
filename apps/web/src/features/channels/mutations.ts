import 'server-only';
import { z } from 'zod';
import type { ServerClient } from '@/lib/supabase/server';

export const channelSchema = z.enum(['chat', 'email']);
export type TestChannel = z.infer<typeof channelSchema>;

export type ChannelTestResult = { ok: true; at: string } | { ok: false; message: string };

/** Hints `send_channel_test` raises whose message is already the sentence to show. */
const SQL_WORDS = new Set(['no_chat_id', 'test_too_soon', 'bad_channel']);

/** A Chat or email test to the signed-in person only (S17, D-069; one a minute per channel). */
export async function sendChannelTest(
  channel: TestChannel,
  { db }: { db: Pick<ServerClient, 'rpc'> },
  now = new Date(),
): Promise<ChannelTestResult> {
  const parsed = channelSchema.safeParse(channel);
  if (!parsed.success) return { ok: false, message: 'Pick Chat or email.' };
  const { error } = await db.rpc('send_channel_test', { p_channel: parsed.data });
  if (!error) return { ok: true, at: now.toISOString() };
  if (error.code === '42501') return { ok: false, message: 'Sign in again to send a test.' };
  if (error.hint && SQL_WORDS.has(error.hint)) return { ok: false, message: error.message };
  return { ok: false, message: 'Couldn’t send the test. Check your connection and try again.' };
}
