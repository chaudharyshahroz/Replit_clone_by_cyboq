import { ButtonLink } from '@/components/ui/button';
import { Wordmark } from '@/components/brand/logo';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <Wordmark />
      <p className="mt-10 font-mono text-sm text-text-muted">404</p>
      <h1 className="display mt-3 text-3xl text-text sm:text-4xl">This page does not exist</h1>
      <p className="mt-4 max-w-sm text-pretty leading-relaxed text-text-secondary">
        The link may be out of date, or the page may have been moved.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <ButtonLink href="/">Back to home</ButtonLink>
      </div>
    </main>
  );
}
