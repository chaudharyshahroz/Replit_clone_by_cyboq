/**
 * Putting a build on the internet (spec §40).
 *
 * A published site is not a preview that lasted longer. The two have opposite
 * lifetimes: a preview exists while somebody is looking at it and is destroyed
 * the moment they are not, while a published site has to be answering at three
 * in the morning when its owner is asleep and a stranger follows a link. So it
 * gets its own container, its own record, and no part of the preview cleanup.
 *
 * It also runs the application the way it will actually be run — built once and
 * served — rather than through a dev server. A dev server recompiles on every
 * request, holds a compiler in memory, and is the reason a published page would
 * otherwise be slower than the preview it came from.
 */
import { resolve4, resolveCname } from 'node:dns/promises';
import { and, eq, ne } from 'drizzle-orm';
import { buildProjects, db, publications, type Publication } from '@reklu/database';
import { sandbox, type SandboxLimits } from '@reklu/sandbox';
import { errors, loadServerEnv, logger, newId, slugify } from '@reklu/shared';
import { loadTree } from './versions';
import { withImageBytes } from './artwork';
import { parseManifest } from './dev-command';

/** The port a published site listens on inside its container. */
const SITE_PORT = 3000;

/**
 * What a live site is allowed.
 *
 * No timeout, unlike a preview: a preview is abandoned and a published site is
 * meant to still be answering next week. The memory is what a Next.js
 * production build needs to compile — the serve that follows it needs far less,
 * but the container is created once and has to survive the peak.
 */
const PUBLISHED_LIMITS: SandboxLimits = {
  timeoutMs: 0,
  memoryMb: 2_048,
  diskMb: 2_048,
  maxOutputBytes: 512_000,
};

export interface PublishResult {
  readonly url: string;
  readonly status: Publication['status'];
  readonly detail: string;
}

/** Whether publishing can run at all, and what is missing when it cannot. */
export function publishAvailability(): { available: boolean; detail: string } {
  const env = loadServerEnv();
  if (!env.PUBLISH_DOMAIN) {
    return {
      available: false,
      detail:
        'Publishing needs PUBLISH_DOMAIN — the domain sites are served under, with wildcard DNS pointing at the proxy.',
    };
  }
  return { available: true, detail: `Sites are served under ${env.PUBLISH_DOMAIN}.` };
}

/**
 * A site's own address, derived once and then never changed.
 *
 * Kept stable even when the project is renamed. The slug is in every link
 * anybody has shared, and renaming a project is not a request to break them.
 */
export async function reserveSlug(name: string, buildProjectId: string): Promise<string> {
  const base = slugify(name).slice(0, 40) || 'site';

  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const [taken] = await db
      .select({ id: publications.id })
      .from(publications)
      .where(
        and(eq(publications.slug, candidate), ne(publications.buildProjectId, buildProjectId)),
      )
      .limit(1);

    if (!taken) return candidate;
  }

  /* Twelve names in and still colliding: use something nobody will collide with. */
  return `${base}-${newId('publication').slice(-6)}`;
}

/** Every hostname a published site answers on. */
export function hostsFor(publication: Pick<Publication, 'slug' | 'customDomain' | 'domainStatus'>): string[] {
  const env = loadServerEnv();
  const hosts = [`${publication.slug}.${env.PUBLISH_DOMAIN}`];

  /*
   * The custom domain joins the router only once its DNS actually points here.
   * Adding it earlier would make the proxy ask a certificate authority for a
   * name that does not resolve to this server, and enough of those failures in
   * an hour gets the whole domain rate-limited — including the names that work.
   */
  if (publication.customDomain && publication.domainStatus === 'live') {
    hosts.push(publication.customDomain);
    /*
     * The apex and its www are one site. Someone typing the address with the
     * prefix is not asking for a different website, and a certificate covering
     * only one of them makes the other a browser warning.
     */
    hosts.push(
      publication.customDomain.startsWith('www.')
        ? publication.customDomain.slice(4)
        : `www.${publication.customDomain}`,
    );
  }

  return hosts;
}

export function publicUrl(publication: Pick<Publication, 'slug' | 'customDomain' | 'domainStatus'>): string {
  const env = loadServerEnv();
  return publication.customDomain && publication.domainStatus === 'live'
    ? `https://${publication.customDomain}`
    : `https://${publication.slug}.${env.PUBLISH_DOMAIN}`;
}

export interface PublishInput {
  readonly buildProjectId: string;
  readonly workspaceId: string;
  readonly report?: (message: string) => Promise<void> | void;
}

/**
 * Build the application and leave it running.
 *
 * The old container is stopped only after the new one is serving. A publish
 * that replaced the site before its replacement worked would take a working
 * website off the internet to put a broken one up.
 */
export async function publishSite(input: PublishInput): Promise<PublishResult> {
  const availability = publishAvailability();
  if (!availability.available) {
    throw errors.notConfigured({
      feature: 'Publishing',
      requiredEnv: ['PUBLISH_DOMAIN'],
      docsPath: '/settings',
    });
  }

  const [project] = await db
    .select({ id: buildProjects.id, name: buildProjects.name, versionId: buildProjects.currentVersionId })
    .from(buildProjects)
    .where(
      and(eq(buildProjects.id, input.buildProjectId), eq(buildProjects.workspaceId, input.workspaceId)),
    )
    .limit(1);

  if (!project) throw errors.notFound('Build project', input.buildProjectId);

  const files = await loadTree(input.buildProjectId, input.workspaceId);
  if (files.length === 0) {
    throw errors.validation('There is nothing to publish yet. Generate the app first.');
  }

  const existing = await currentPublication(input.buildProjectId, input.workspaceId);
  const slug = existing?.slug ?? (await reserveSlug(project.name, input.buildProjectId));

  const record =
    existing ??
    (
      await db
        .insert(publications)
        .values({
          id: newId('publication'),
          buildProjectId: input.buildProjectId,
          workspaceId: input.workspaceId,
          slug,
          status: 'publishing',
        })
        .returning()
    )[0]!;

  await db
    .update(publications)
    .set({ status: 'publishing', statusDetail: null, updatedAt: new Date() })
    .where(eq(publications.id, record.id));

  const driver = sandbox();
  const hosts = hostsFor({ ...record, slug });

  try {
    await input.report?.('Starting a server for the published site');
    const handle = await driver.create(`site-${slug}`, PUBLISHED_LIMITS, {
      publishPort: SITE_PORT,
      hosts,
    });

    await input.report?.('Copying the application');
    await driver.writeFiles(handle, await withImageBytes(files));

    await input.report?.('Installing dependencies');
    const install = await driver.exec(handle, {
      command: 'npm',
      args: ['install', '--no-audit', '--no-fund'],
      timeoutMs: 900_000,
    });
    if (install.exitCode !== 0) {
      throw new Error(`Dependencies failed to install: ${tail(install.stderr || install.stdout)}`);
    }

    /*
     * Built, not served from source. This is the difference between a published
     * page and a preview: a dev server recompiles on every request and holds a
     * compiler in memory to do it, which is the wrong thing to leave running
     * under a public address.
     */
    await input.report?.('Building for production');
    const built = await driver.exec(handle, {
      command: 'npm',
      args: ['run', 'build'],
      timeoutMs: 900_000,
    });
    if (built.exitCode !== 0) {
      throw new Error(`The production build failed: ${tail(built.stderr || built.stdout)}`);
    }

    await input.report?.('Starting the site');
    const manifest = parseManifest(files.find((file) => file.path === 'package.json')?.content);
    await driver.startPreview(handle, SITE_PORT, productionCommand(manifest));

    /* Only now is the old one taken down: the replacement is already serving. */
    if (record.containerId && record.containerId !== handle.externalId) {
      await driver.destroy({ ...handle, externalId: record.containerId }).catch((error) => {
        logger.warn('The previous published container could not be removed', { error });
      });
    }

    const [saved] = await db
      .update(publications)
      .set({
        slug,
        containerId: handle.externalId,
        buildVersionId: project.versionId,
        status: 'live',
        statusDetail: null,
        publishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(publications.id, record.id))
      .returning();

    const url = publicUrl(saved ?? { ...record, slug });
    logger.info('Published a site', { buildProjectId: input.buildProjectId, url });
    return { url, status: 'live', detail: `Live at ${url}` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await db
      .update(publications)
      .set({ status: 'failed', statusDetail: detail.slice(0, 500), updatedAt: new Date() })
      .where(eq(publications.id, record.id));
    throw error;
  }
}

/** The site currently published for a project, if there is one. */
export async function currentPublication(
  buildProjectId: string,
  workspaceId: string,
): Promise<Publication | undefined> {
  const [row] = await db
    .select()
    .from(publications)
    .where(
      and(
        eq(publications.buildProjectId, buildProjectId),
        eq(publications.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return row;
}

/** Take a site off the internet, keeping its address for when it comes back. */
export async function unpublishSite(
  buildProjectId: string,
  workspaceId: string,
): Promise<{ detail: string }> {
  const record = await currentPublication(buildProjectId, workspaceId);
  if (!record) return { detail: 'This build is not published.' };

  if (record.containerId) {
    const driver = sandbox();
    await driver
      .destroy({
        id: `site-${record.slug}`,
        externalId: record.containerId,
        driver: 'docker',
        limits: PUBLISHED_LIMITS,
        isIsolated: true,
      })
      .catch((error) => logger.warn('Could not stop a published site', { error }));
  }

  await db
    .update(publications)
    .set({ status: 'stopped', containerId: null, updatedAt: new Date() })
    .where(eq(publications.id, record.id));

  return { detail: 'The site is no longer reachable. Its address is kept for when you publish again.' };
}

/** The last few lines of a failure, which is where the reason lives. */
function tail(output: string): string {
  return output.trim().split('\n').slice(-6).join('\n').slice(0, 600);
}

/**
 * How to serve a built application.
 *
 * Derived from the manifest rather than assumed: `npm start` is right for Next
 * and wrong for a Vite site, which builds to static files and has no server to
 * start at all.
 */
export function productionCommand(manifest: ReturnType<typeof parseManifest>): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  const scripts = manifest?.scripts ?? {};
  const env = { PORT: String(SITE_PORT), HOST: '0.0.0.0', NODE_ENV: 'production' };

  if (scripts['start']) return { command: 'npm', args: ['run', 'start'], env };

  /*
   * No start script means the build produced files rather than a server. Served
   * statically from wherever the build put them.
   */
  const directory = scripts['build']?.includes('vite') ? 'dist' : 'out';
  return {
    command: 'npx',
    args: ['--yes', 'serve', '-s', directory, '-l', String(SITE_PORT)],
    env,
  };
}


/**
 * A hostname somebody typed, reduced to the thing we can actually route.
 *
 * Rejects rather than repairs where the difference matters: a URL with a path
 * is not a domain, and quietly discarding the path would publish to a hostname
 * the person did not think they were giving.
 */
export function normalizeDomain(input: string): { domain: string } | { error: string } {
  const trimmed = input.trim().toLowerCase().replace(/^https?:\/\//, '');
  const domain = trimmed.replace(/\/+$/, '');

  if (!domain) return { error: 'Enter a domain.' };
  if (domain.includes('/')) return { error: 'Enter just the domain, without a path.' };
  if (domain.includes(':')) return { error: 'Enter just the domain, without a port.' };
  if (domain.length > 253) return { error: 'That domain is too long.' };

  if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) {
    return { error: 'That does not look like a domain name.' };
  }

  const env = loadServerEnv();
  /*
   * Refused, and specifically. A site claiming a name under Reklu's own domains
   * would be issued a router rule for a hostname Reklu itself answers on, and
   * which one wins is then a matter of container start order.
   */
  for (const reserved of [env.PUBLISH_DOMAIN, env.SANDBOX_PREVIEW_DOMAIN, appHost()]) {
    if (reserved && (domain === reserved || domain.endsWith(`.${reserved}`))) {
      return { error: `${domain} is part of Reklu's own domain and cannot be claimed.` };
    }
  }

  return { domain };
}

function appHost(): string | undefined {
  try {
    return new URL(loadServerEnv().APP_URL).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** What somebody has to do to their DNS, in the words their registrar uses. */
export function dnsInstructions(
  domain: string,
  slug: string,
): {
  readonly type: 'A' | 'CNAME';
  readonly name: string;
  readonly value: string;
} {
  const env = loadServerEnv();
  const apex = domain.split('.').length === 2;

  /*
   * An apex domain gets an A record because most DNS providers cannot put a
   * CNAME there — the standard forbids one alongside the SOA and NS records
   * every zone root carries. A subdomain gets a CNAME pointing at the site's
   * own Reklu address, which keeps working if the server ever moves.
   */
  return apex
    ? { type: 'A', name: '@', value: env.PUBLISH_SERVER_IP ?? 'the server address' }
    : {
        type: 'CNAME',
        name: domain.split('.')[0]!,
        value: `${slug}.${env.PUBLISH_DOMAIN}`,
      };
}

/**
 * Check that a domain actually points here, before telling the proxy about it.
 *
 * The order matters and is the whole reason this is a separate step. A router
 * carrying a hostname that does not resolve to this server makes the proxy ask
 * a certificate authority for it, the challenge fails, and enough failures in
 * an hour rate-limits the account — taking down certificate renewal for names
 * that were working perfectly well.
 */
export async function checkDomain(
  domain: string,
  slug: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const env = loadServerEnv();
  const target = `${slug}.${env.PUBLISH_DOMAIN}`;

  try {
    /* A CNAME to the site's own address is the answer for a subdomain. */
    const aliases = await resolveCname(domain).catch(() => [] as string[]);
    if (aliases.some((alias) => alias.replace(/\.$/, '').toLowerCase() === target)) {
      return { ok: true };
    }

    const addresses = await resolve4(domain);
    if (addresses.length === 0) {
      return { ok: false, detail: `${domain} has no A record yet.` };
    }

    /*
     * Compared against the address the instructions gave. Where none is
     * configured there is nothing to compare against, and claiming the check
     * passed would be a guess presented as a verification.
     */
    if (!env.PUBLISH_SERVER_IP) {
      return {
        ok: false,
        detail:
          'PUBLISH_SERVER_IP is not set, so Reklu cannot confirm the domain points at this server.',
      };
    }

    if (!addresses.includes(env.PUBLISH_SERVER_IP)) {
      return {
        ok: false,
        detail: `${domain} points at ${addresses.join(', ')} rather than ${env.PUBLISH_SERVER_IP}. DNS changes can take a few hours to spread.`,
      };
    }

    return { ok: true };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      return { ok: false, detail: `${domain} does not resolve yet. DNS changes take time to spread.` };
    }
    return { ok: false, detail: `Could not look up ${domain}: ${String(code ?? error)}` };
  }
}

/**
 * Claim a domain for a site.
 *
 * Recorded as pending, not live. Nothing routes until the DNS is checked, and
 * the check is a separate step because it is the person's registrar that has to
 * act next, not Reklu.
 */
export async function setCustomDomain(
  buildProjectId: string,
  workspaceId: string,
  input: string,
): Promise<{ error?: string; domain?: string }> {
  const record = await currentPublication(buildProjectId, workspaceId);
  if (!record) return { error: 'Publish the site before adding a domain to it.' };

  const parsed = normalizeDomain(input);
  if ('error' in parsed) return { error: parsed.error };

  const [claimed] = await db
    .select({ id: publications.id })
    .from(publications)
    .where(and(eq(publications.customDomain, parsed.domain), ne(publications.id, record.id)))
    .limit(1);

  /*
   * Refused rather than taken. Two sites answering on one hostname produce two
   * router rules with the same match, and which one wins is decided by
   * container start order — a site that works until something restarts.
   */
  if (claimed) return { error: `${parsed.domain} is already used by another site.` };

  await db
    .update(publications)
    .set({
      customDomain: parsed.domain,
      domainStatus: 'pending',
      domainDetail: null,
      updatedAt: new Date(),
    })
    .where(eq(publications.id, record.id));

  return { domain: parsed.domain };
}

/**
 * Check the DNS and, if it points here, start serving the domain.
 *
 * Routing it means recreating the container, because Docker labels are fixed
 * when a container is created. That costs a rebuild — which is why this is not
 * done speculatively on every check, only when the DNS has actually arrived.
 */
export async function activateCustomDomain(
  buildProjectId: string,
  workspaceId: string,
  report?: (message: string) => Promise<void> | void,
): Promise<{ status: Publication['domainStatus']; detail: string }> {
  const record = await currentPublication(buildProjectId, workspaceId);
  if (!record?.customDomain) return { status: 'none', detail: 'No domain has been added.' };

  const check = await checkDomain(record.customDomain, record.slug);

  if (!check.ok) {
    await db
      .update(publications)
      .set({ domainStatus: 'pending', domainDetail: check.detail, updatedAt: new Date() })
      .where(eq(publications.id, record.id));
    return { status: 'pending', detail: check.detail };
  }

  await db
    .update(publications)
    .set({ domainStatus: 'live', domainDetail: null, updatedAt: new Date() })
    .where(eq(publications.id, record.id));

  /* The rule lives in the container's labels, so serving it means a new one. */
  await report?.('The domain resolves here. Restarting the site to serve it');
  await publishSite({ buildProjectId, workspaceId, report });

  return {
    status: 'live',
    detail: `https://${record.customDomain} is live. The certificate is issued on the first request and can take a minute.`,
  };
}

/** Give a domain up, and stop answering on it. */
export async function removeCustomDomain(
  buildProjectId: string,
  workspaceId: string,
  report?: (message: string) => Promise<void> | void,
): Promise<{ detail: string }> {
  const record = await currentPublication(buildProjectId, workspaceId);
  if (!record?.customDomain) return { detail: 'No domain to remove.' };

  const wasLive = record.domainStatus === 'live';

  await db
    .update(publications)
    .set({ customDomain: null, domainStatus: 'none', domainDetail: null, updatedAt: new Date() })
    .where(eq(publications.id, record.id));

  /* Only worth a rebuild if the container is actually routing the name. */
  if (wasLive) await publishSite({ buildProjectId, workspaceId, report });

  return { detail: 'The domain has been removed. The site keeps its Reklu address.' };
}
