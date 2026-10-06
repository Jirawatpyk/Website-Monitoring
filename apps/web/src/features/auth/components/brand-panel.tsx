import { BrandMark } from '@/components/app-shell/brand';

/** Left panel of the sign-in page (Login board), desktop only. */
export function BrandPanel() {
  return (
    <aside
      aria-label="About DxT Monitor"
      className="hidden shrink-0 basis-5/12 flex-col justify-between bg-bg-surface-strong px-14 py-12 text-fg-inverted lg:flex"
    >
      <BrandMark inverted />
      <div className="flex flex-col gap-4">
        <p className="m-0 font-display text-5xl leading-tight font-semibold tracking-tight">
          Know a client site is down before the client does.
        </p>
        <p className="m-0 text-base opacity-75">DxT Website Monitoring · for the DxT team</p>
      </div>
      <p className="m-0 text-xs opacity-75">Times shown in Thailand time (UTC+7)</p>
    </aside>
  );
}
