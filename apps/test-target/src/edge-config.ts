/**
 * Reads one Edge Config item over its REST endpoint. `connection` is the EDGE_CONFIG value Vercel
 * adds when a store is connected to the project: `https://edge-config.vercel.com/<id>?token=<t>`.
 * Returns undefined when the store or item is missing or unreachable — never throws.
 */
export async function readEdgeConfigItem(
  connection: string | undefined,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  if (!connection) return undefined;
  try {
    const store = new URL(connection);
    const item = new URL(`${store.pathname.replace(/\/$/, '')}/item/${encodeURIComponent(key)}`, store.origin);
    item.search = store.search;
    const res = await fetchImpl(item, { signal: AbortSignal.timeout(3_000) });
    return res.ok ? await res.json() : undefined;
  } catch {
    return undefined;
  }
}
