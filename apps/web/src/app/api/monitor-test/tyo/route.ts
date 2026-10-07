import { monitorTestHandler } from '@/features/sites/server';

// Test check from TYO (D-025): pinned to its region in vercel.json, like the TYO probe.
export const POST = monitorTestHandler('TYO');
