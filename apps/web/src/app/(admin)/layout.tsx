import type { ReactNode } from 'react';
import { requireSuperAdmin } from '@/lib/admin';

/**
 * Admin route group.
 *
 * Deliberately outside `(app)`, so the product sidebar — Chat, Build, Projects
 * — is not rendered here. Admin was originally nested inside it and appeared
 * as a page *within* the product, which is the wrong mental model: this is a
 * different tool that happens to share a deployment.
 *
 * The gate runs here as well as in the admin layout and on each page. A layout
 * is not a security boundary by itself, and none of the three relies on
 * another having run.
 */
export default async function AdminRouteGroupLayout({ children }: { children: ReactNode }) {
  await requireSuperAdmin();
  return <div className="min-h-screen bg-surface-sunk">{children}</div>;
}
