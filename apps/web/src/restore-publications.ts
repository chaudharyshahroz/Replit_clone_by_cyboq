/** Reconcile durable site containers after the web service is replaced. */
import { restorePublishedSites } from '@reklu/build';

restorePublishedSites().catch((error: unknown) => {
  console.error('Could not reconcile published sites after startup', error);
  process.exitCode = 1;
});
