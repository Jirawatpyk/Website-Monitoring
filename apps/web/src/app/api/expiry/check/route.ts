import { checkNowHandler } from '@/features/expiry/server';

// Check now on the Expiry page (D-066 item 4): pinned to sin1 in vercel.json, like the expiry cron.
export const POST = checkNowHandler();
