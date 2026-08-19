import type { Metadata } from 'next';
import { SEARCH_PROVIDER_ENV } from '@reklu/research';
import { features } from '@reklu/shared';
import { ResearchView } from '@/components/research/research-view';
import { getAppContext } from '@/lib/auth-context';

export const metadata: Metadata = { title: 'Research' };
export const dynamic = 'force-dynamic';

export default async function ResearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await getAppContext();
  const available = features();
  const { q } = await searchParams;

  return (
    <ResearchView
      webSearchConfigured={available.webSearch}
      searchEnvVars={Object.values(SEARCH_PROVIDER_ENV)}
      // Capped so a crafted link cannot paste an unbounded string into the box.
      initialQuery={q?.slice(0, 2_000)}
    />
  );
}
