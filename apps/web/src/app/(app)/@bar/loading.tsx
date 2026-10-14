/**
 * The bar's own loading state. Without it the slot inherits `(app)/loading.tsx` — the Overview skeleton —
 * and the top bar grew to 600 px while a page streamed (found by /verify, D-045). A static bar renders at
 * once; Site detail and Incident have their own loading bar with the back arrow.
 */
export default function BarLoading() {
  return null;
}
