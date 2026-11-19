'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { getAccess } from '@/lib/auth/session';
import { serverEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { serviceDb } from '@/server/db';
import { notifierDeps } from '@/server/notifier/deps';
import { dispatchNotifications } from '@/server/notifier/dispatch';
import * as m from './mutations';

/**
 * Sends the signed-in person a test (Alert channels' "Send test card / email", Profile's "Send me a
 * test alert" for every role). The SQL checks who and the cooldown; the message leaves from this request
 * (the notifier cron sweeps up anything left within a minute).
 */
export async function sendChannelTest(channel: m.TestChannel): Promise<m.ChannelTestResult> {
  const access = await getAccess();
  if (access.status !== 'active') return { ok: false, message: 'Sign in again to send a test.' };
  const result = await m.sendChannelTest(channel, { db: await createClient() });
  if (result.ok) {
    after(async () => {
      try {
        await dispatchNotifications(notifierDeps(serviceDb(), serverEnv()), {
          deadline: Date.now() + 30_000,
        });
      } catch (err) {
        console.error(JSON.stringify({ event: 'channel_test_flush_failed', error: String(err) }));
      }
    });
    revalidatePath('/settings/alert-channels');
  }
  return result;
}
