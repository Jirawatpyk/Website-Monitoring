import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getSiteBar } from '@/features/sites/server';

/**
 * A site that doesn't exist (or can't be read) answers 404 for its page and sub-pages. The check sits here,
 * above the pages' `loading.tsx`: inside it the skeleton has already streamed a 200 by the time the page
 * finds nothing. One request-cached read the tab title and the phone bar share (`getSiteBar`); "Site not
 * found" is `sites/not-found.tsx`.
 */
export default async function SiteLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  if (!(await getSiteBar(siteId))) notFound();
  return children;
}
