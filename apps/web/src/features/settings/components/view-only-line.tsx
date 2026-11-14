import { IconEye } from '@jirawatpyk/aura-react/icons';

/** The Settings pages' phone line (§22.5, MUsers, MSecurity): view only, edits on a larger screen. */
export function ViewOnlyLine() {
  return (
    <div className="flex items-start gap-2.5 rounded-aura-md border border-border-default bg-bg-surface p-3 text-sm md:hidden">
      <IconEye size="sm" aria-hidden className="mt-0.5 text-fg-secondary" />
      <span>
        <b className="font-semibold">View only on phones.</b>{' '}
        <span className="text-fg-secondary">Admins change policies on a larger screen.</span>
      </span>
    </div>
  );
}
