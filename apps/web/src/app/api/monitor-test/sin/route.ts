import { monitorTestHandler } from '@/features/sites/server';

// Test check from SIN (D-025): pinned to its region in vercel.json, like the SIN probe.
export const POST = monitorTestHandler('SIN');
