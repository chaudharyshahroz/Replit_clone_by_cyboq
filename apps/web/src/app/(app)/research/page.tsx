import type { Metadata } from 'next';
import { SEARCH_PROVIDER_ENV } from '@reklu/research';
import { features } from '@reklu/shared';
import { ResearchView } from '@/components/research/research-view';
import { getAppContext } from '@/lib/auth-context';

export const metadata: Metadata = { title: 'Research' };
export const dynamic = 'force-dynamic';

export default async function ResearchPage() {
  await getAppContext();
  const available = features();

  return (
    <ResearchView
      webSearchConfigured={available.webSearch}
      searchEnvVars={Object.values(SEARCH_PROVIDER_ENV)}
    />
  );
}
