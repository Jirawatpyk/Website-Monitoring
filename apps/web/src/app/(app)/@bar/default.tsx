import { PhoneBar } from '@/components/app-shell/phone-bar';

/**
 * The bar when Next can't match the slot on a full load (parallel routes need a `default`). Every page has
 * its own slot page (`loading-coverage.test.ts`), so this is only the brand as a safe fallback (D-045).
 */
export default function DefaultBar() {
  return <PhoneBar title={null} />;
}
