import 'server-only';
import { serverEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { loadChannels, type ChannelsData } from './queries';

export type { ChannelsData } from './queries';

export interface ChannelsPageData {
  data: ChannelsData;
  now: string;
}

/** Settings › Alert channels for an Admin (S17, D-069). */
export async function getChannelsPage(viewer: { id: string }, now = new Date()): Promise<ChannelsPageData> {
  const env = serverEnv();
  const data = await loadChannels(
    await createClient(),
    {
      chatConnected: !!env.GOOGLE_CHAT_ALERTS_WEBHOOK_URL,
      emailFrom: env.RESEND_API_KEY && env.ALERT_EMAIL_FROM ? env.ALERT_EMAIL_FROM : null,
    },
    viewer.id,
    now,
  );
  return { data, now: now.toISOString() };
}
