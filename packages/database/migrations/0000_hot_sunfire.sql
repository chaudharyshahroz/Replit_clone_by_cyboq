CREATE TYPE "public"."agent_run_status" AS ENUM('planning', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."agent_step_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."ai_provider_kind" AS ENUM('anthropic', 'openai', 'google', 'xai', 'deepseek', 'custom');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'denied', 'expired');--> statement-breakpoint
CREATE TYPE "public"."artifact_status" AS ENUM('draft', 'generating', 'ready', 'failed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."artifact_type" AS ENUM('document', 'presentation', 'spreadsheet', 'image', 'video', 'code', 'application', 'website', 'research_report', 'diagram');--> statement-breakpoint
CREATE TYPE "public"."build_status" AS ENUM('draft', 'briefing', 'planning', 'generating', 'installing', 'checking', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."build_target" AS ENUM('website', 'web_app', 'mobile_app', 'api', 'dashboard');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('connected', 'needs_attention', 'disconnected', 'error');--> statement-breakpoint
CREATE TYPE "public"."conversation_mode" AS ENUM('chat', 'research', 'build', 'compare', 'agent');--> statement-breakpoint
CREATE TYPE "public"."deployment_status" AS ENUM('queued', 'building', 'deploying', 'ready', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."file_status" AS ENUM('uploading', 'scanning', 'parsing', 'indexing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."mcp_transport" AS ENUM('http', 'sse', 'stdio');--> statement-breakpoint
CREATE TYPE "public"."memory_kind" AS ENUM('fact', 'preference', 'decision', 'summary', 'instruction');--> statement-breakpoint
CREATE TYPE "public"."memory_source" AS ENUM('user', 'inferred', 'system');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('system', 'user', 'assistant', 'tool');--> statement-breakpoint
CREATE TYPE "public"."model_cost_tier" AS ENUM('economy', 'standard', 'premium');--> statement-breakpoint
CREATE TYPE "public"."model_speed" AS ENUM('fast', 'balanced', 'slow');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('research_complete', 'build_complete', 'deployment_complete', 'deployment_failed', 'invitation', 'billing_issue', 'agent_approval_required', 'job_failed');--> statement-breakpoint
CREATE TYPE "public"."project_role" AS ENUM('owner', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."project_visibility" AS ENUM('private', 'workspace');--> statement-breakpoint
CREATE TYPE "public"."research_mode" AS ENUM('quick', 'research', 'deep');--> statement-breakpoint
CREATE TYPE "public"."research_stage" AS ENUM('queued', 'analyzing_intent', 'planning', 'generating_queries', 'discovering_sources', 'fetching_sources', 'extracting_content', 'ranking_relevance', 'cross_validating', 'collecting_evidence', 'reasoning', 'writing_report', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."sandbox_status" AS ENUM('provisioning', 'running', 'idle', 'stopped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."skill_category" AS ENUM('development', 'design', 'research', 'marketing', 'sales', 'productivity', 'data', 'finance', 'writing', 'other');--> statement-breakpoint
CREATE TYPE "public"."skill_visibility" AS ENUM('private', 'workspace', 'public');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('web', 'news', 'academic', 'file', 'project', 'connection');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused');--> statement-breakpoint
CREATE TYPE "public"."tool_execution_status" AS ENUM('pending_approval', 'approved', 'denied', 'running', 'succeeded', 'failed', 'timed_out');--> statement-breakpoint
CREATE TYPE "public"."tool_risk_class" AS ENUM('read_only', 'create', 'update', 'delete', 'financial', 'security_sensitive');--> statement-breakpoint
CREATE TYPE "public"."usage_kind" AS ENUM('chat', 'research', 'build', 'embedding', 'image', 'video', 'sandbox', 'deployment', 'tool_call', 'agent');--> statement-breakpoint
CREATE TYPE "public"."workspace_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" timestamp with time zone,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"session_token" text NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	"user_agent" text,
	"ip_address" text,
	"last_active_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"email_verified" timestamp with time zone,
	"name" text,
	"image" text,
	"password_hash" text,
	"is_super_admin" boolean DEFAULT false NOT NULL,
	"suspended_at" timestamp with time zone,
	"suspended_reason" text,
	"onboarded_at" timestamp with time zone,
	"usage_intent" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" text DEFAULT 'email_verification' NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"role" "workspace_role" DEFAULT 'member' NOT NULL,
	"token_hash" text NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"invited_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "workspace_role" DEFAULT 'member' NOT NULL,
	"invited_by" text,
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"image" text,
	"is_personal" boolean DEFAULT false NOT NULL,
	"owner_id" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "project_role" DEFAULT 'editor' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" "memory_kind" NOT NULL,
	"source" "memory_source" NOT NULL,
	"content" text NOT NULL,
	"source_message_id" text,
	"source_file_id" text,
	"source_research_id" text,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"embedding" vector(1536),
	"importance" real DEFAULT 0.5 NOT NULL,
	"access_count" integer DEFAULT 0 NOT NULL,
	"last_accessed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"icon" text DEFAULT 'folder',
	"color" text,
	"instructions" text,
	"preferred_model_id" text,
	"default_skill_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled_tool_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visibility" "project_visibility" DEFAULT 'private' NOT NULL,
	"archived_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"user_id" text NOT NULL,
	"title" text,
	"title_is_auto" boolean DEFAULT true NOT NULL,
	"mode" "conversation_mode" DEFAULT 'chat' NOT NULL,
	"model_key" text,
	"compare_model_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skill_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parent_conversation_id" text,
	"branched_from_message_id" text,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"message_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "message_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"file_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"role" "message_role" NOT NULL,
	"content" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_text" text,
	"model_key" text,
	"compare_group_id" text,
	"sequence" integer NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"finish_reason" text,
	"error_code" text,
	"error_message" text,
	"edited_at" timestamp with time zone,
	"artifact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "ai_models" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"model_identifier" text NOT NULL,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"context_window" integer NOT NULL,
	"max_output_tokens" integer NOT NULL,
	"supports_vision" boolean DEFAULT false NOT NULL,
	"supports_tools" boolean DEFAULT false NOT NULL,
	"supports_streaming" boolean DEFAULT true NOT NULL,
	"supports_reasoning" boolean DEFAULT false NOT NULL,
	"supports_structured_output" boolean DEFAULT false NOT NULL,
	"supports_files" boolean DEFAULT false NOT NULL,
	"supports_embeddings" boolean DEFAULT false NOT NULL,
	"speed" "model_speed" DEFAULT 'balanced' NOT NULL,
	"cost_tier" "model_cost_tier" DEFAULT 'standard' NOT NULL,
	"input_cost_per_million" numeric(12, 4) DEFAULT '0' NOT NULL,
	"output_cost_per_million" numeric(12, 4) DEFAULT '0' NOT NULL,
	"best_for" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"routing_priority" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"available_on_plans" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"internal_only" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"deprecated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "ai_provider_kind" NOT NULL,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"maintenance_mode" boolean DEFAULT false NOT NULL,
	"maintenance_message" text,
	"api_key_env_var" text NOT NULL,
	"base_url_override" text,
	"last_healthy_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text,
	"project_id" text,
	"conversation_id" text,
	"message_id" text,
	"model_id" text,
	"model_key" text NOT NULL,
	"provider_key" text NOT NULL,
	"kind" "usage_kind" NOT NULL,
	"auto_routed" boolean DEFAULT false NOT NULL,
	"routing_reason" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"latency_ms" integer,
	"time_to_first_token_ms" integer,
	"status" text DEFAULT 'succeeded' NOT NULL,
	"error_code" text,
	"fell_back_from" text,
	"request_id" text,
	"job_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"file_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"embedding" vector(1536),
	"locator" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"uploaded_by" text,
	"filename" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"declared_content_type" text,
	"size_bytes" bigint NOT NULL,
	"checksum" text NOT NULL,
	"status" "file_status" DEFAULT 'uploading' NOT NULL,
	"status_detail" text,
	"extracted_text" text,
	"page_count" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"folder" text DEFAULT '/' NOT NULL,
	"indexed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "artifact_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"artifact_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb,
	"content_text" text,
	"storage_key" text,
	"change_summary" text,
	"created_by_id" text,
	"model_key" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"created_by_id" text,
	"type" "artifact_type" NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"status" "artifact_status" DEFAULT 'draft' NOT NULL,
	"current_version_id" text,
	"version_count" integer DEFAULT 0 NOT NULL,
	"source_conversation_id" text,
	"source_message_id" text,
	"source_research_id" text,
	"derived_from_artifact_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "research_citations" (
	"id" text PRIMARY KEY NOT NULL,
	"research_session_id" text NOT NULL,
	"source_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"claim" text NOT NULL,
	"supporting_passage" text,
	"report_offset" integer,
	"citation_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"user_id" text NOT NULL,
	"conversation_id" text,
	"query" text NOT NULL,
	"mode" "research_mode" DEFAULT 'research' NOT NULL,
	"stage" "research_stage" DEFAULT 'queued' NOT NULL,
	"stage_detail" text,
	"stage_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"plan" jsonb,
	"queries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"report" text,
	"answer" text,
	"sources_discovered" integer DEFAULT 0 NOT NULL,
	"sources_fetched" integer DEFAULT 0 NOT NULL,
	"sources_used" integer DEFAULT 0 NOT NULL,
	"sources_failed" integer DEFAULT 0 NOT NULL,
	"artifact_id" text,
	"job_id" text,
	"error_code" text,
	"error_message" text,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "research_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"research_session_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"type" "source_type" DEFAULT 'web' NOT NULL,
	"url" text,
	"title" text,
	"domain" text,
	"published_at" timestamp with time zone,
	"snippet" text,
	"extracted_content" text,
	"fetch_error" text,
	"retrieved_at" timestamp with time zone,
	"http_status" integer,
	"relevance_score" real,
	"corroboration_score" real,
	"contradicted_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"embedding" vector(1536),
	"found_by_query" text,
	"citation_index" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build_files" (
	"id" text PRIMARY KEY NOT NULL,
	"build_project_id" text NOT NULL,
	"build_version_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"path" text NOT NULL,
	"content" text,
	"storage_key" text,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"language" text,
	"is_binary" boolean DEFAULT false NOT NULL,
	"is_generated" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"conversation_id" text,
	"created_by_id" text,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"target" "build_target" DEFAULT 'website' NOT NULL,
	"status" "build_status" DEFAULT 'draft' NOT NULL,
	"status_detail" text,
	"brief" jsonb,
	"brief_approved_at" timestamp with time zone,
	"framework" text,
	"package_manager" text DEFAULT 'pnpm',
	"imported_from_repo" text,
	"codebase_analysis" jsonb,
	"current_version_id" text,
	"version_count" integer DEFAULT 0 NOT NULL,
	"last_built_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "build_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"build_project_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"version" integer NOT NULL,
	"prompt" text,
	"change_summary" text,
	"changed_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"commit_sha" text,
	"model_key" text,
	"created_by_id" text,
	"checks_passed" boolean,
	"check_output" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"build_project_id" text,
	"build_version_id" text,
	"connection_id" text,
	"triggered_by_id" text,
	"provider" text DEFAULT 'vercel' NOT NULL,
	"external_id" text,
	"status" "deployment_status" DEFAULT 'queued' NOT NULL,
	"status_detail" text,
	"url" text,
	"production_url" text,
	"is_production" boolean DEFAULT false NOT NULL,
	"build_logs" text,
	"build_logs_key" text,
	"error_message" text,
	"environment_variable_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"job_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "repository_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"build_project_id" text,
	"connection_id" text,
	"provider" text DEFAULT 'github' NOT NULL,
	"owner" text NOT NULL,
	"repo" text NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"is_private" boolean DEFAULT true NOT NULL,
	"external_id" text,
	"html_url" text,
	"last_pushed_at" timestamp with time zone,
	"last_push_sha" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "sandboxes" (
	"id" text PRIMARY KEY NOT NULL,
	"build_project_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"driver" text NOT NULL,
	"external_id" text,
	"status" "sandbox_status" DEFAULT 'provisioning' NOT NULL,
	"preview_url" text,
	"port" integer,
	"memory_limit_mb" integer,
	"disk_limit_mb" integer,
	"timeout_ms" integer,
	"last_active_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text,
	"provider" text NOT NULL,
	"display_name" text NOT NULL,
	"status" "connection_status" DEFAULT 'connected' NOT NULL,
	"status_detail" text,
	"external_account_id" text,
	"external_account_name" text,
	"external_account_avatar" text,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "mcp_servers" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text,
	"created_by_id" text,
	"name" text NOT NULL,
	"description" text,
	"transport" "mcp_transport" DEFAULT 'http' NOT NULL,
	"endpoint" text,
	"command" text,
	"args" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"credential_encrypted" text,
	"env_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "connection_status" DEFAULT 'connected' NOT NULL,
	"status_detail" text,
	"tool_schema_hash" text,
	"tool_schema_approved_at" timestamp with time zone,
	"tool_schema_approved_by" text,
	"last_discovered_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "mcp_tools" (
	"id" text PRIMARY KEY NOT NULL,
	"mcp_server_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"input_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"risk_class" "tool_risk_class" DEFAULT 'update' NOT NULL,
	"risk_class_overridden_by" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"auto_approve_reads" boolean DEFAULT false NOT NULL,
	"execution_count" integer DEFAULT 0 NOT NULL,
	"last_executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"refresh_token_encrypted" text,
	"token_type" text DEFAULT 'Bearer',
	"expires_at" timestamp with time zone,
	"key_version" integer DEFAULT 1 NOT NULL,
	"last_refreshed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text,
	"project_id" text,
	"conversation_id" text,
	"message_id" text,
	"agent_run_id" text,
	"mcp_tool_id" text,
	"tool_name" text NOT NULL,
	"risk_class" "tool_risk_class" NOT NULL,
	"status" "tool_execution_status" DEFAULT 'pending_approval' NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"error_message" text,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"denied_reason" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_installs" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text,
	"skill_version_id" text,
	"granted_mcp_tool_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"last_used_at" timestamp with time zone,
	"use_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"version" integer NOT NULL,
	"instructions" text NOT NULL,
	"examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"knowledge" text,
	"file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"templates" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_model_key" text,
	"allowed_tool_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requested_mcp_tool_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"changelog" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"author_id" text,
	"name" text NOT NULL,
	"handle" text NOT NULL,
	"description" text NOT NULL,
	"icon" text DEFAULT 'sparkles',
	"category" "skill_category" DEFAULT 'other' NOT NULL,
	"is_built_in" boolean DEFAULT false NOT NULL,
	"visibility" "skill_visibility" DEFAULT 'private' NOT NULL,
	"current_version_id" text,
	"install_count" integer DEFAULT 0 NOT NULL,
	"rating" real,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "agent_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_run_id" text NOT NULL,
	"agent_step_id" text,
	"workspace_id" text NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"risk_class" text NOT NULL,
	"payload" jsonb,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"denial_reason" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"user_id" text NOT NULL,
	"conversation_id" text,
	"objective" text NOT NULL,
	"status" "agent_run_status" DEFAULT 'planning' NOT NULL,
	"plan" jsonb,
	"current_step_index" integer DEFAULT 0 NOT NULL,
	"total_steps" integer DEFAULT 0 NOT NULL,
	"max_steps" integer DEFAULT 40 NOT NULL,
	"max_cost_usd" text DEFAULT '5.00' NOT NULL,
	"steps_executed" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"artifact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_code" text,
	"error_message" text,
	"job_id" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "agent_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_run_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"step_index" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "agent_step_status" DEFAULT 'pending' NOT NULL,
	"kind" text NOT NULL,
	"tool_name" text,
	"model_key" text,
	"input" jsonb,
	"output" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"duration_ms" integer,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_monthly_usd" numeric(10, 2) DEFAULT '0' NOT NULL,
	"price_yearly_usd" numeric(10, 2) DEFAULT '0' NOT NULL,
	"stripe_product_id" text,
	"stripe_price_id_monthly" text,
	"stripe_price_id_yearly" text,
	"limits" jsonb NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"last_webhook_event_id" text,
	"last_webhook_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "usage_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text,
	"project_id" text,
	"kind" "usage_kind" NOT NULL,
	"operation" text NOT NULL,
	"provider_key" text,
	"model_key" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"quantity" numeric(12, 4) DEFAULT '0' NOT NULL,
	"estimated_cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"billable_units" numeric(12, 4) DEFAULT '0' NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"ai_request_id" text,
	"job_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"user_id" text,
	"action" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"actor_id" text,
	"actor_email" text,
	"is_admin_action" boolean DEFAULT false NOT NULL,
	"action" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"changes" jsonb,
	"ip_address" text,
	"user_agent" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"rollout_percentage" integer DEFAULT 0 NOT NULL,
	"enabled_workspace_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled_plan_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text,
	"project_id" text,
	"queue" text NOT NULL,
	"kind" text NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"stage" text,
	"stage_index" integer DEFAULT 0 NOT NULL,
	"total_stages" integer,
	"stage_detail" text,
	"input" jsonb,
	"output" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"error_code" text,
	"error_message" text,
	"cancel_requested_at" timestamp with time zone,
	"resource_type" text,
	"resource_id" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"resource_type" text,
	"resource_id" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memories" ADD CONSTRAINT "project_memories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memories" ADD CONSTRAINT "project_memories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memories" ADD CONSTRAINT "project_memories_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_model_id_ai_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ai_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_chunks" ADD CONSTRAINT "file_chunks_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_chunks" ADD CONSTRAINT "file_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_citations" ADD CONSTRAINT "research_citations_research_session_id_research_sessions_id_fk" FOREIGN KEY ("research_session_id") REFERENCES "public"."research_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_citations" ADD CONSTRAINT "research_citations_source_id_research_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."research_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_citations" ADD CONSTRAINT "research_citations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_sessions" ADD CONSTRAINT "research_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_sessions" ADD CONSTRAINT "research_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_sessions" ADD CONSTRAINT "research_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_sources" ADD CONSTRAINT "research_sources_research_session_id_research_sessions_id_fk" FOREIGN KEY ("research_session_id") REFERENCES "public"."research_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_sources" ADD CONSTRAINT "research_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_files" ADD CONSTRAINT "build_files_build_project_id_build_projects_id_fk" FOREIGN KEY ("build_project_id") REFERENCES "public"."build_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_files" ADD CONSTRAINT "build_files_build_version_id_build_versions_id_fk" FOREIGN KEY ("build_version_id") REFERENCES "public"."build_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_files" ADD CONSTRAINT "build_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_projects" ADD CONSTRAINT "build_projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_projects" ADD CONSTRAINT "build_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_projects" ADD CONSTRAINT "build_projects_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_versions" ADD CONSTRAINT "build_versions_build_project_id_build_projects_id_fk" FOREIGN KEY ("build_project_id") REFERENCES "public"."build_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_versions" ADD CONSTRAINT "build_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_versions" ADD CONSTRAINT "build_versions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_build_project_id_build_projects_id_fk" FOREIGN KEY ("build_project_id") REFERENCES "public"."build_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_triggered_by_id_users_id_fk" FOREIGN KEY ("triggered_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_connections" ADD CONSTRAINT "repository_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_connections" ADD CONSTRAINT "repository_connections_build_project_id_build_projects_id_fk" FOREIGN KEY ("build_project_id") REFERENCES "public"."build_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandboxes" ADD CONSTRAINT "sandboxes_build_project_id_build_projects_id_fk" FOREIGN KEY ("build_project_id") REFERENCES "public"."build_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandboxes" ADD CONSTRAINT "sandboxes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_tool_schema_approved_by_users_id_fk" FOREIGN KEY ("tool_schema_approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tools" ADD CONSTRAINT "mcp_tools_mcp_server_id_mcp_servers_id_fk" FOREIGN KEY ("mcp_server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tools" ADD CONSTRAINT "mcp_tools_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tools" ADD CONSTRAINT "mcp_tools_risk_class_overridden_by_users_id_fk" FOREIGN KEY ("risk_class_overridden_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_credentials" ADD CONSTRAINT "oauth_credentials_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_credentials" ADD CONSTRAINT "oauth_credentials_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_mcp_tool_id_mcp_tools_id_fk" FOREIGN KEY ("mcp_tool_id") REFERENCES "public"."mcp_tools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_installs" ADD CONSTRAINT "skill_installs_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_installs" ADD CONSTRAINT "skill_installs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_installs" ADD CONSTRAINT "skill_installs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_installs" ADD CONSTRAINT "skill_installs_skill_version_id_skill_versions_id_fk" FOREIGN KEY ("skill_version_id") REFERENCES "public"."skill_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_agent_step_id_agent_steps_id_fk" FOREIGN KEY ("agent_step_id") REFERENCES "public"."agent_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_approvals" ADD CONSTRAINT "agent_approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_idx" ON "accounts" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_idx" ON "sessions" USING btree ("session_token");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_normalized_idx" ON "users" USING btree ("email_normalized");--> statement-breakpoint
CREATE INDEX "users_last_seen_idx" ON "users" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_tokens_pk" ON "verification_tokens" USING btree ("identifier","token_hash");--> statement-breakpoint
CREATE INDEX "verification_tokens_expires_idx" ON "verification_tokens" USING btree ("expires");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_idx" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_workspace_idx" ON "invitations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "invitations" USING btree ("email_normalized");--> statement-breakpoint
CREATE INDEX "invitations_status_idx" ON "invitations" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_unique_idx" ON "workspace_members" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspace_members_workspace_idx" ON "workspace_members" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_slug_idx" ON "workspaces" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "workspaces_owner_idx" ON "workspaces" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "workspaces_deleted_idx" ON "workspaces" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_unique_idx" ON "project_members" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "project_members_user_idx" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_memories_project_idx" ON "project_memories" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_memories_kind_idx" ON "project_memories" USING btree ("project_id","kind");--> statement-breakpoint
CREATE INDEX "project_memories_approved_idx" ON "project_memories" USING btree ("project_id","approved_at");--> statement-breakpoint
CREATE INDEX "project_memories_deleted_idx" ON "project_memories" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_workspace_slug_idx" ON "projects" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX "projects_workspace_idx" ON "projects" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "projects_activity_idx" ON "projects" USING btree ("workspace_id","last_activity_at");--> statement-breakpoint
CREATE INDEX "projects_deleted_idx" ON "projects" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "conversations_workspace_idx" ON "conversations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "conversations_user_recent_idx" ON "conversations" USING btree ("user_id","last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_project_idx" ON "conversations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "conversations_mode_idx" ON "conversations" USING btree ("workspace_id","mode");--> statement-breakpoint
CREATE INDEX "conversations_deleted_idx" ON "conversations" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "message_attachments_unique_idx" ON "message_attachments" USING btree ("message_id","file_id");--> statement-breakpoint
CREATE INDEX "message_attachments_file_idx" ON "message_attachments" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_conversation_sequence_idx" ON "messages" USING btree ("conversation_id","sequence");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "messages_workspace_idx" ON "messages" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "messages_compare_group_idx" ON "messages" USING btree ("compare_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_models_key_idx" ON "ai_models" USING btree ("key");--> statement-breakpoint
CREATE INDEX "ai_models_provider_idx" ON "ai_models" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "ai_models_enabled_idx" ON "ai_models" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "ai_models_routing_idx" ON "ai_models" USING btree ("enabled","routing_priority");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_providers_key_idx" ON "ai_providers" USING btree ("key");--> statement-breakpoint
CREATE INDEX "ai_requests_workspace_time_idx" ON "ai_requests" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_requests_user_idx" ON "ai_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_requests_project_idx" ON "ai_requests" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ai_requests_model_idx" ON "ai_requests" USING btree ("model_key");--> statement-breakpoint
CREATE INDEX "ai_requests_conversation_idx" ON "ai_requests" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_chunks_file_index_idx" ON "file_chunks" USING btree ("file_id","chunk_index");--> statement-breakpoint
CREATE INDEX "file_chunks_workspace_idx" ON "file_chunks" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "file_chunks_project_idx" ON "file_chunks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "files_workspace_idx" ON "files" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "files_project_idx" ON "files" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "files_status_idx" ON "files" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "files_workspace_checksum_idx" ON "files" USING btree ("workspace_id","checksum");--> statement-breakpoint
CREATE INDEX "files_deleted_idx" ON "files" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_versions_unique_idx" ON "artifact_versions" USING btree ("artifact_id","version");--> statement-breakpoint
CREATE INDEX "artifact_versions_artifact_idx" ON "artifact_versions" USING btree ("artifact_id");--> statement-breakpoint
CREATE INDEX "artifacts_workspace_idx" ON "artifacts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "artifacts_project_idx" ON "artifacts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "artifacts_type_idx" ON "artifacts" USING btree ("workspace_id","type");--> statement-breakpoint
CREATE INDEX "artifacts_conversation_idx" ON "artifacts" USING btree ("source_conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_project_slug_idx" ON "artifacts" USING btree ("project_id","slug");--> statement-breakpoint
CREATE INDEX "artifacts_deleted_idx" ON "artifacts" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "research_citations_session_idx" ON "research_citations" USING btree ("research_session_id");--> statement-breakpoint
CREATE INDEX "research_citations_source_idx" ON "research_citations" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "research_workspace_idx" ON "research_sessions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "research_user_idx" ON "research_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "research_project_idx" ON "research_sessions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "research_stage_idx" ON "research_sessions" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "research_deleted_idx" ON "research_sessions" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "research_sources_session_idx" ON "research_sources" USING btree ("research_session_id");--> statement-breakpoint
CREATE INDEX "research_sources_workspace_idx" ON "research_sources" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "research_sources_domain_idx" ON "research_sources" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "research_sources_session_url_idx" ON "research_sources" USING btree ("research_session_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "build_files_version_path_idx" ON "build_files" USING btree ("build_version_id","path");--> statement-breakpoint
CREATE INDEX "build_files_project_idx" ON "build_files" USING btree ("build_project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "build_projects_workspace_slug_idx" ON "build_projects" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX "build_projects_workspace_idx" ON "build_projects" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "build_projects_project_idx" ON "build_projects" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "build_projects_deleted_idx" ON "build_projects" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "build_versions_unique_idx" ON "build_versions" USING btree ("build_project_id","version");--> statement-breakpoint
CREATE INDEX "build_versions_project_idx" ON "build_versions" USING btree ("build_project_id");--> statement-breakpoint
CREATE INDEX "deployments_workspace_idx" ON "deployments" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "deployments_build_idx" ON "deployments" USING btree ("build_project_id");--> statement-breakpoint
CREATE INDEX "deployments_status_idx" ON "deployments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "repository_connections_workspace_idx" ON "repository_connections" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repository_connections_build_idx" ON "repository_connections" USING btree ("build_project_id");--> statement-breakpoint
CREATE INDEX "sandboxes_build_idx" ON "sandboxes" USING btree ("build_project_id");--> statement-breakpoint
CREATE INDEX "sandboxes_status_idx" ON "sandboxes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sandboxes_expires_idx" ON "sandboxes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "connections_workspace_idx" ON "connections" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "connections_provider_idx" ON "connections" USING btree ("workspace_id","provider");--> statement-breakpoint
CREATE INDEX "connections_status_idx" ON "connections" USING btree ("status");--> statement-breakpoint
CREATE INDEX "connections_deleted_idx" ON "connections" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "mcp_servers_workspace_idx" ON "mcp_servers" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "mcp_servers_status_idx" ON "mcp_servers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "mcp_servers_deleted_idx" ON "mcp_servers" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_tools_server_name_idx" ON "mcp_tools" USING btree ("mcp_server_id","name");--> statement-breakpoint
CREATE INDEX "mcp_tools_workspace_idx" ON "mcp_tools" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "mcp_tools_enabled_idx" ON "mcp_tools" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_credentials_connection_idx" ON "oauth_credentials" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "oauth_credentials_expires_idx" ON "oauth_credentials" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "tool_executions_workspace_time_idx" ON "tool_executions" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "tool_executions_tool_idx" ON "tool_executions" USING btree ("mcp_tool_id");--> statement-breakpoint
CREATE INDEX "tool_executions_status_idx" ON "tool_executions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tool_executions_agent_idx" ON "tool_executions" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "tool_executions_conversation_idx" ON "tool_executions" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_installs_unique_idx" ON "skill_installs" USING btree ("skill_id","workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "skill_installs_workspace_idx" ON "skill_installs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "skill_installs_user_idx" ON "skill_installs" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_versions_unique_idx" ON "skill_versions" USING btree ("skill_id","version");--> statement-breakpoint
CREATE INDEX "skill_versions_skill_idx" ON "skill_versions" USING btree ("skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_workspace_handle_idx" ON "skills" USING btree ("workspace_id","handle");--> statement-breakpoint
CREATE INDEX "skills_category_idx" ON "skills" USING btree ("category");--> statement-breakpoint
CREATE INDEX "skills_visibility_idx" ON "skills" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "skills_builtin_idx" ON "skills" USING btree ("is_built_in");--> statement-breakpoint
CREATE INDEX "skills_deleted_idx" ON "skills" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "agent_approvals_run_idx" ON "agent_approvals" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "agent_approvals_status_idx" ON "agent_approvals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_approvals_workspace_idx" ON "agent_approvals" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agent_runs_workspace_idx" ON "agent_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agent_runs_user_idx" ON "agent_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_runs_status_idx" ON "agent_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_steps_run_index_idx" ON "agent_steps" USING btree ("agent_run_id","step_index");--> statement-breakpoint
CREATE INDEX "agent_steps_run_idx" ON "agent_steps" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "agent_steps_status_idx" ON "agent_steps" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_key_idx" ON "plans" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_workspace_idx" ON "subscriptions" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_stripe_idx" ON "subscriptions" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "subscriptions_status_idx" ON "subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "usage_ledger_workspace_period_idx" ON "usage_ledger" USING btree ("workspace_id","period_start");--> statement-breakpoint
CREATE INDEX "usage_ledger_kind_idx" ON "usage_ledger" USING btree ("workspace_id","kind","period_start");--> statement-breakpoint
CREATE INDEX "usage_ledger_user_idx" ON "usage_ledger" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "usage_ledger_created_idx" ON "usage_ledger" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "activities_workspace_time_idx" ON "activities" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "activities_project_idx" ON "activities" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "audit_logs_workspace_time_idx" ON "audit_logs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_admin_idx" ON "audit_logs" USING btree ("is_admin_action");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flags_key_idx" ON "feature_flags" USING btree ("key");--> statement-breakpoint
CREATE INDEX "jobs_workspace_idx" ON "jobs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "jobs_queue_status_idx" ON "jobs" USING btree ("queue","status");--> statement-breakpoint
CREATE INDEX "jobs_resource_idx" ON "jobs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "jobs_user_recent_idx" ON "jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "notifications_workspace_idx" ON "notifications" USING btree ("workspace_id");