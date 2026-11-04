import { clearBeat, localSupabaseEnabled } from './support/local-supabase';

/**
 * Once, after every project: the monitor-fault specs (probes.spec.ts) age the shared engine beats, and
 * the desktop and phone projects run them side by side — a per-file afterAll would clear them under
 * the other project (S12b review). A beat that never ran is no fault: the seed state.
 */
export default async function globalTeardown(): Promise<void> {
  if (!localSupabaseEnabled) return;
  await clearBeat('engine-sweep');
  await clearBeat('engine-run');
}
