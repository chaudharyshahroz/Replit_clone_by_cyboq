/**
 * Job contracts.
 *
 * Each queue declares its payload schema here, so producer and consumer cannot
 * drift: a worker validates what it receives rather than trusting that whoever
 * enqueued it used the right shape.
 *
 * Stages are declared per job kind because progress must reflect **real**
 * backend positions (spec §89) — the worker announces the stage it is actually
 * entering, and the UI renders that list rather than a synthetic percentage.
 */
import { z } from 'zod';

export const QUEUE_NAMES = [
  'research',
  'build',
  'embed',
  'deploy',
  'media',
  'agent',
  'maintenance',
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

// ---------------------------------------------------------------------------
// Payload schemas
// ---------------------------------------------------------------------------

export const DeepResearchPayload = z.object({
  researchSessionId: z.string(),
  workspaceId: z.string(),
  userId: z.string(),
  query: z.string().min(1),
  mode: z.enum(['quick', 'research', 'deep']),
  projectId: z.string().nullable().optional(),
});

export const EmbedFilePayload = z.object({
  fileId: z.string(),
  workspaceId: z.string(),
  projectId: z.string().nullable().optional(),
});

export const BuildProjectPayload = z.object({
  buildProjectId: z.string(),
  workspaceId: z.string(),
  userId: z.string(),
  prompt: z.string(),
});

export const DeployPayload = z.object({
  deploymentId: z.string(),
  workspaceId: z.string(),
  buildProjectId: z.string(),
});

export const MediaPayload = z.object({
  artifactId: z.string(),
  workspaceId: z.string(),
  userId: z.string(),
  kind: z.enum(['image', 'video']),
  prompt: z.string(),
});

export const AgentRunPayload = z.object({
  agentRunId: z.string(),
  workspaceId: z.string(),
  userId: z.string(),
  objective: z.string(),
});

export const MaintenancePayload = z.object({
  task: z.enum(['prune_sessions', 'reap_sandboxes', 'expire_approvals']),
});

/** Maps a job kind to its payload schema and its real stage sequence. */
export const JOB_KINDS = {
  deep_research: {
    queue: 'research' as const,
    schema: DeepResearchPayload,
    stages: [
      'analyzing_intent',
      'planning',
      'generating_queries',
      'discovering_sources',
      'fetching_sources',
      'extracting_content',
      'ranking_relevance',
      'cross_validating',
      'collecting_evidence',
      'reasoning',
      'writing_report',
    ],
  },
  embed_file: {
    queue: 'embed' as const,
    schema: EmbedFilePayload,
    stages: ['parsing', 'chunking', 'embedding', 'indexing'],
  },
  build_project: {
    queue: 'build' as const,
    schema: BuildProjectPayload,
    stages: [
      'interpreting_product',
      'planning_architecture',
      'generating_files',
      'installing_dependencies',
      'running_checks',
      'starting_preview',
    ],
  },
  deploy: {
    queue: 'deploy' as const,
    schema: DeployPayload,
    stages: ['preparing', 'pushing_repository', 'building', 'deploying', 'verifying'],
  },
  generate_media: {
    queue: 'media' as const,
    schema: MediaPayload,
    stages: ['queued_with_provider', 'generating', 'downloading', 'storing'],
  },
  agent_run: {
    queue: 'agent' as const,
    schema: AgentRunPayload,
    stages: ['planning', 'executing', 'finalizing'],
  },
  maintenance: {
    queue: 'maintenance' as const,
    schema: MaintenancePayload,
    stages: ['running'],
  },
} as const;

export type JobKind = keyof typeof JOB_KINDS;

export type PayloadFor<K extends JobKind> = z.infer<(typeof JOB_KINDS)[K]['schema']>;

export function stagesFor(kind: JobKind): readonly string[] {
  return JOB_KINDS[kind].stages;
}

export function queueFor(kind: JobKind): QueueName {
  return JOB_KINDS[kind].queue;
}

/** Validate an incoming payload at the worker boundary. */
export function parsePayload<K extends JobKind>(kind: K, raw: unknown): PayloadFor<K> {
  return JOB_KINDS[kind].schema.parse(raw) as PayloadFor<K>;
}
