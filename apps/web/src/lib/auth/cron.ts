import 'server-only';
import { serverEnv } from '@/lib/env';
import { hasBearer, unauthorized } from './bearer';

/**
 * Wraps a Vercel Cron handler: rejects anything without `Authorization: Bearer $CRON_SECRET`.
 * Every cron job also pings its Healthchecks.io URL when it finishes (PRD §9) — add that in the handler.
 */
export function cronHandler(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    if (!hasBearer(request, serverEnv().CRON_SECRET)) return unauthorized();
    return handler(request);
  };
}
