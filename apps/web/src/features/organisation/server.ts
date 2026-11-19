import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { loadOrganisation, type OrganisationData } from './queries';

export type { OrganisationData } from './queries';

/** Settings › Organisation for an Admin (S17, D-069). */
export async function getOrganisationPage(): Promise<OrganisationData> {
  return loadOrganisation(await createClient());
}
