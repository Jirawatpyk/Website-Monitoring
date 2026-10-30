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
import type { OncallResult } from './mutations';
import type {
  ChecklistInput,
  DecideSwapInput,
  HandOverInput,
  RequestSwapInput,
  RespondSwapInput,
  SaveRotationInput,
  SwapIdInput,
  TestTokenInput,
} from './schemas';

/**
 * On-call as the signed-in person (D-048). The SQL decides who may act and writes the audit row and the
 * event (with its messages) in the same transaction. No Undo in this flow (§27.1): the messages leave
 * from this request at once; the notifier cron sweeps up anything left within a minute.
 */
async function run<T>(
  input: T,
  fn: (input: T, deps: m.OncallDeps) => Promise<OncallResult>,
  { send = true }: { send?: boolean } = {},
): Promise<OncallResult> {
  const access = await getAccess();
  if (access.status !== 'active') return { ok: false, message: 'Sign in again to continue.' };
  const result = await fn(input, { db: await createClient() });
  if (result.ok) {
    if (send) {
      after(async () => {
        try {
          await dispatchNotifications(notifierDeps(serviceDb(), serverEnv()), {
            deadline: Date.now() + 30_000,
          });
        } catch (err) {
          console.error(JSON.stringify({ event: 'oncall_flush_failed', error: String(err) }));
        }
      });
    }
    revalidatePath('/oncall');
    revalidatePath('/');
  }
  return result;
}

export async function saveRotation(input: SaveRotationInput) {
  return run(input, m.saveRotation);
}
export async function requestSwap(input: RequestSwapInput) {
  return run(input, m.requestSwap);
}
export async function respondSwap(input: RespondSwapInput) {
  return run(input, m.respondSwap);
}
export async function decideSwap(input: DecideSwapInput) {
  return run(input, m.decideSwap);
}
export async function withdrawSwap(input: SwapIdInput) {
  return run(input, m.withdrawSwap);
}
export async function handOver(input: HandOverInput) {
  return run(input, m.handOver);
}
/** A tick on the phone checklist sends nothing. */
export async function setChecklist(input: ChecklistInput) {
  return run(input, m.setChecklist, { send: false });
}
export async function sendTest() {
  return run({}, m.sendTest);
}
export async function confirmTest(input: TestTokenInput) {
  return run(input, m.confirmTest, { send: false });
}
