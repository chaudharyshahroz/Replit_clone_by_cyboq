/**
 * Platform infrastructure: jobs, notifications, activity, audit logs, and
 * feature flags.
 *
 * `jobs` is the durable record behind every long-running operation. The queue
 * (Redis/BullMQ) is the transport, but the row here is the truth — so a Redis
 * restart loses throughput, not the user's deep research run.
 */
import { index, integer, jsonb, boolean, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { primaryId, timestamps, tsColumn } from './_shared';
import { jobStatusEnum, notificationKindEnum } from './enums';
import { users } from './identity';
import { workspaces } from './tenancy';

export const jobs = pgTable(
  'jobs',
  {
    id: primaryId('job'),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    projectId: text('project_id'),

    /** Queue name: 'research' | 'build' | 'embed' | 'deploy' | 'media' | 'agent'. */
    queue: text('queue').notNull(),
    /** Specific task within the queue, e.g. 'deep_research'. */
    kind: text('kind').notNull(),
    status: jobStatusEnum('status').notNull().default('queued'),

    /** Human-readable current stage. Reflects real backend position (spec §89). */
    stage: text('stage'),
    stageIndex: integer('stage_index').notNull().default(0),
    totalStages: integer('total_stages'),
    stageDetail: text('stage_detail'),

    input: jsonb('input').$type<Record<string, unknown>>(),
    output: jsonb('output').$type<unknown>(),

    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),

    /**
     * Cooperative cancellation: workers check this between stages so a cancelled
     * job stops spending on provider calls (spec §106).
     */
    cancelRequestedAt: tsColumn('cancel_requested_at'),

    /** Links the job to the domain row it is producing. */
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),

    startedAt: tsColumn('started_at'),
    completedAt: tsColumn('completed_at'),
    ...timestamps,
  },
  (table) => [
    index('jobs_workspace_idx').on(table.workspaceId),
    index('jobs_status_idx').on(table.status),
    index('jobs_queue_status_idx').on(table.queue, table.status),
    index('jobs_resource_idx').on(table.resourceType, table.resourceId),
    index('jobs_user_recent_idx').on(table.userId, table.createdAt),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: primaryId('notification'),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    kind: notificationKindEnum('kind').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    /** Deep link to the thing that happened. */
    href: text('href'),

    resourceType: text('resource_type'),
    resourceId: text('resource_id'),

    readAt: tsColumn('read_at'),
    ...timestamps,
  },
  (table) => [
    index('notifications_user_unread_idx').on(table.userId, table.readAt),
    index('notifications_workspace_idx').on(table.workspaceId),
  ],
);

/** Product activity feed — what happened in a workspace or project. */
export const activities = pgTable(
  'activities',
  {
    id: primaryId('activity'),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: text('project_id'),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),

    /** e.g. 'project.created', 'deployment.succeeded', 'skill.installed'. */
    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    index('activities_workspace_time_idx').on(table.workspaceId, table.createdAt),
    index('activities_project_idx').on(table.projectId),
  ],
);

/**
 * Security audit log — deliberately separate from `activities`.
 *
 * Activities are a product feature users read. Audit logs are a security record:
 * append-only, never soft-deleted with their subject, and covering the
 * privileged operations that matter in an incident (spec §102).
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: primaryId('auditLog'),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    /** Nullable and `set null` so deleting a user cannot erase the trail. */
    actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
    /** Preserved even if the user row goes away. */
    actorEmail: text('actor_email'),
    /** True when performed via the super-admin panel. */
    isAdminAction: boolean('is_admin_action').notNull().default(false),

    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),

    /** Before/after for privileged mutations. Secret values are never included. */
    changes: jsonb('changes').$type<Record<string, unknown>>(),

    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    index('audit_logs_workspace_time_idx').on(table.workspaceId, table.createdAt),
    index('audit_logs_actor_idx').on(table.actorId),
    index('audit_logs_action_idx').on(table.action),
    index('audit_logs_admin_idx').on(table.isAdminAction),
  ],
);

export const featureFlags = pgTable(
  'feature_flags',
  {
    id: primaryId('featureFlag'),
    key: text('key').notNull(),
    description: text('description'),

    enabled: boolean('enabled').notNull().default(false),
    /** 0–100. Deterministic per workspace, so a workspace's answer is stable. */
    rolloutPercentage: integer('rollout_percentage').notNull().default(0),
    /** Always-on overrides, evaluated before the percentage. */
    enabledWorkspaceIds: jsonb('enabled_workspace_ids').$type<string[]>().notNull().default([]),
    enabledUserIds: jsonb('enabled_user_ids').$type<string[]>().notNull().default([]),
    /** Restrict to plans, e.g. ["pro","team"]. */
    enabledPlanKeys: jsonb('enabled_plan_keys').$type<string[]>().notNull().default([]),
    ...timestamps,
  },
  (table) => [uniqueIndex('feature_flags_key_idx').on(table.key)],
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type FeatureFlag = typeof featureFlags.$inferSelect;

/**
 * People waiting for Reklu to open.
 *
 * Deliberately thin. Somebody who has given an email address and nothing else
 * has not consented to being profiled, and the only questions this table is
 * meant to answer are how many are waiting, in what order they arrived, and who
 * has been let in — so it holds what answers those and stops.
 *
 * There is no IP address, no user agent and no referrer. Each would be personal
 * data collected before there is an account to attach it to, kept for a purpose
 * nobody stated, and none of them is needed to send an invitation.
 */
export const waitlistSignups = pgTable(
  'waitlist_signups',
  {
    id: primaryId('waitlistSignup'),
    /** Stored lowercase and trimmed; the unique index is what makes that matter. */
    email: text('email').notNull(),
    /** Where they came from, when the link said so. Free text, never required. */
    source: text('source'),
    /** Set when an invitation goes out, so nobody is invited twice. */
    invitedAt: tsColumn('invited_at'),
    ...timestamps,
  },
  (table) => [
    /*
     * One row per address. Somebody signing up twice is not two people, and a
     * duplicate would mean two invitations to the same inbox.
     */
    uniqueIndex('waitlist_signups_email_idx').on(table.email),
    index('waitlist_signups_created_idx').on(table.createdAt),
  ],
);

export type WaitlistSignup = typeof waitlistSignups.$inferSelect;
