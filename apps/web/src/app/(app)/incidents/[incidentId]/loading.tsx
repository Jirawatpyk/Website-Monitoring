import { Skeleton } from '@jirawatpyk/aura-react';

/** While the incident loads: the shape of the MobileAck page. */
export default function Loading() {
  return (
    <div
      className="mx-auto flex w-full max-w-xl flex-col gap-3"
      aria-busy="true"
      aria-label="Loading incident"
    >
      <Skeleton variant="text" lines={1} width="40%" />
      <Skeleton variant="rect" height={40} />
      <Skeleton variant="rect" height={120} />
      <Skeleton variant="text" lines={3} />
      {/* The action bar's place, so nothing jumps when the page arrives. */}
      <Skeleton variant="rect" height={96} />
    </div>
  );
}
