/**
 * Shared states from the EmptyStates board — every list and dashboard uses them. "Never show a blank
 * table or a green dashboard you can't trust": each says what's true, how old it is, and the next step.
 * Empty results use AURA `EmptyState` directly (first run, nothing open, filter matches nothing).
 */
export { LoadingList, STILL_LOADING_AFTER_MS } from './loading-list';
export { NoAccess, type PersonWhoCanAct } from './no-access';
export { CardSkeleton, PageHeaderSkeleton, PageSkeleton } from './page-skeletons';
export { OfflineStrip, OFFLINE_RETRY_MS } from './offline-strip';
