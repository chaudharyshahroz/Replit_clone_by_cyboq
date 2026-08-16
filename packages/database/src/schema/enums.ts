/**
 * Postgres enums.
 *
 * These are enums rather than free text because they are closed domains that
 * authorization, routing, and billing branch on. A typo in a role or a risk
 * class should fail at write time, not silently grant access.
 */
import { pgEnum } from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

/** Spec §72. Deliberately coarse now; granular permissions layer on top later. */
export const workspaceRoleEnum = pgEnum('workspace_role', ['owner', 'admin', 'member']);
export const invitationStatusEnum = pgEnum('invitation_status', [
  'pending',
  'accepted',
  'revoked',
  'expired',
]);
export const projectRoleEnum = pgEnum('project_role', ['owner', 'editor', 'viewer']);
export const projectVisibilityEnum = pgEnum('project_visibility', [
  'private', // creator only
  'workspace', // every workspace member
]);

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export const aiProviderKindEnum = pgEnum('ai_provider_kind', [
  'anthropic',
  'openai',
  'google',
  'xai',
  'deepseek',
  'custom',
]);

/** Coarse buckets used by Reklu Auto for cost- and latency-aware routing. */
export const modelSpeedEnum = pgEnum('model_speed', ['fast', 'balanced', 'slow']);
export const modelCostTierEnum = pgEnum('model_cost_tier', ['economy', 'standard', 'premium']);

export const messageRoleEnum = pgEnum('message_role', ['system', 'user', 'assistant', 'tool']);

export const conversationModeEnum = pgEnum('conversation_mode', [
  'chat',
  'research',
  'build',
  'compare',
  'agent',
]);

// ---------------------------------------------------------------------------
// Knowledge
// ---------------------------------------------------------------------------

export const fileStatusEnum = pgEnum('file_status', [
  'uploading',
  'scanning', // security + MIME validation
  'parsing',
  'indexing', // chunking + embeddings
  'ready',
  'failed',
]);

/**
 * Spec §18: memory is not an ever-growing transcript. These kinds are stored,
 * retrieved, and expired differently.
 */
export const memoryKindEnum = pgEnum('memory_kind', [
  'fact', // durable, user-approvable statement about the project
  'preference', // how the user wants Reklu to work here
  'decision', // a choice made, with its rationale
  'summary', // rolled-up conversation context
  'instruction', // explicit project instruction
]);

export const memorySourceEnum = pgEnum('memory_source', [
  'user', // stated directly by the user
  'inferred', // derived by Reklu; requires approval before it becomes durable
  'system', // produced by a pipeline (e.g. conversation summarization)
]);

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

export const artifactTypeEnum = pgEnum('artifact_type', [
  'document',
  'presentation',
  'spreadsheet',
  'image',
  'video',
  'code',
  'application',
  'website',
  'research_report',
  'diagram',
]);

export const artifactStatusEnum = pgEnum('artifact_status', [
  'draft',
  'generating',
  'ready',
  'failed',
  'archived',
]);

// ---------------------------------------------------------------------------
// Research
// ---------------------------------------------------------------------------

export const researchModeEnum = pgEnum('research_mode', ['quick', 'research', 'deep']);

/** Mirrors the pipeline in docs/RESEARCH_ARCHITECTURE.md. Progress is real. */
export const researchStageEnum = pgEnum('research_stage', [
  'queued',
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
  'completed',
  'failed',
  'cancelled',
]);

export const sourceTypeEnum = pgEnum('source_type', [
  'web',
  'news',
  'academic',
  'file', // a user-uploaded file
  'project', // existing project knowledge
  'connection', // via a connected service / MCP
]);

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export const buildTargetEnum = pgEnum('build_target', [
  'website',
  'web_app',
  'mobile_app',
  'api',
  'dashboard',
]);

export const buildStatusEnum = pgEnum('build_status', [
  'draft',
  'briefing',
  'planning',
  'generating',
  'installing',
  'checking',
  'ready',
  'failed',
]);

export const sandboxStatusEnum = pgEnum('sandbox_status', [
  'provisioning',
  'running',
  'idle',
  'stopped',
  'failed',
]);

export const deploymentStatusEnum = pgEnum('deployment_status', [
  'queued',
  'building',
  'deploying',
  'ready',
  'failed',
  'cancelled',
]);

// ---------------------------------------------------------------------------
// Tools / MCP  (see docs/MCP_SECURITY.md)
// ---------------------------------------------------------------------------

export const connectionStatusEnum = pgEnum('connection_status', [
  'connected',
  'needs_attention', // token expired or scope revoked
  'disconnected',
  'error',
]);

export const mcpTransportEnum = pgEnum('mcp_transport', ['http', 'sse', 'stdio']);

/**
 * Spec §49. The risk class decides whether a tool may run under standing
 * authorization or requires explicit human approval at call time.
 */
export const toolRiskClassEnum = pgEnum('tool_risk_class', [
  'read_only',
  'create',
  'update',
  'delete',
  'financial',
  'security_sensitive',
]);

export const toolExecutionStatusEnum = pgEnum('tool_execution_status', [
  'pending_approval',
  'approved',
  'denied',
  'running',
  'succeeded',
  'failed',
  'timed_out',
]);

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export const skillVisibilityEnum = pgEnum('skill_visibility', [
  'private', // author only
  'workspace', // shared with the workspace
  'public', // listed in the library
]);

export const skillCategoryEnum = pgEnum('skill_category', [
  'development',
  'design',
  'research',
  'marketing',
  'sales',
  'productivity',
  'data',
  'finance',
  'writing',
  'other',
]);

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export const agentRunStatusEnum = pgEnum('agent_run_status', [
  'planning',
  'running',
  'awaiting_approval',
  'succeeded',
  'failed',
  'cancelled',
]);

export const agentStepStatusEnum = pgEnum('agent_step_status', [
  'pending',
  'running',
  'succeeded',
  'failed',
  'skipped',
]);

export const approvalStatusEnum = pgEnum('approval_status', [
  'pending',
  'approved',
  'denied',
  'expired',
]);

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'unpaid',
  'paused',
]);

/** What a usage row is metering. Cost control depends on this being complete. */
export const usageKindEnum = pgEnum('usage_kind', [
  'chat',
  'research',
  'build',
  'embedding',
  'image',
  'video',
  'sandbox',
  'deployment',
  'tool_call',
  'agent',
]);

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

export const jobStatusEnum = pgEnum('job_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export const notificationKindEnum = pgEnum('notification_kind', [
  'research_complete',
  'build_complete',
  'deployment_complete',
  'deployment_failed',
  'invitation',
  'billing_issue',
  'agent_approval_required',
  'job_failed',
]);
