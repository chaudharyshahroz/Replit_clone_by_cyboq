import Link from 'next/link';
import { Wordmark } from '@/components/brand/logo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="px-6 py-6">
        <Link href="/" className="inline-block rounded-md" aria-label="Reklu home">
          <Wordmark />
        </Link>
      </header>

      <main id="main" className="flex flex-1 items-center justify-center px-6 pb-24">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
