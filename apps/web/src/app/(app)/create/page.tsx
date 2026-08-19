import type { Metadata } from 'next';
import { Wand2 } from 'lucide-react';
import { createAvailability } from '@reklu/create';
import { getAppContext } from '@/lib/auth-context';
import { CreateForm } from '@/components/create/create-form';

export const metadata: Metadata = { title: 'Create' };
export const dynamic = 'force-dynamic';

export default async function CreatePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string }>;
}) {
  await getAppContext();
  const availability = await createAvailability();
  const { q, kind } = await searchParams;

  return (
    <div className="mx-auto max-w-2xl px-6 py-14">
      <header>
        <h1 className="display flex items-center gap-2.5 text-3xl text-text">
          <Wand2 className="h-7 w-7 text-accent" strokeWidth={1.5} />
          Create
        </h1>
        <p className="mt-2 text-pretty text-text-secondary">
          Documents, slide decks and images. Everything you make is saved to
          Artifacts with version history.
        </p>
      </header>

      <div className="mt-8">
        <CreateForm
          availability={availability.map((entry) => ({
            kind: entry.kind,
            available: entry.available,
            detail: entry.detail,
          }))}
          // Capped, and the kind is only honoured if it is one this deployment
          // actually offers.
          initialPrompt={q?.slice(0, 2_000)}
          initialKind={availability.some((entry) => entry.kind === kind) ? kind : undefined}
        />
      </div>
    </div>
  );
}
