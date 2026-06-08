CREATE TYPE "public"."actor_type" AS ENUM('human', 'agent');--> statement-breakpoint
CREATE TYPE "public"."artifact_type" AS ENUM('document', 'script', 'code', 'config', 'test', 'other');--> statement-breakpoint
CREATE TYPE "public"."host_status" AS ENUM('online', 'offline', 'degraded');--> statement-breakpoint
CREATE TYPE "public"."mailbox_status" AS ENUM('active', 'disabled', 'unassigned');--> statement-breakpoint
CREATE TYPE "public"."message_kind" AS ENUM('human_mail', 'agent_reply', 'delegation_mail', 'summary_mail', 'system_note');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('bootstrapping', 'idle', 'running', 'waiting_human', 'waiting_child', 'failed', 'cleared');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('new', 'in_progress', 'paused', 'done', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."thread_status" AS ENUM('open', 'waiting_human', 'waiting_agent', 'completed', 'blocked');--> statement-breakpoint
CREATE TABLE "artifacts" (
	"artifact_id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"mailbox" text NOT NULL,
	"artifact_type" "artifact_type" NOT NULL,
	"path" text NOT NULL,
	"branch" text,
	"commit_sha" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"machine_id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"host_version" text,
	"host_status" "host_status" DEFAULT 'online' NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailboxes" (
	"mailbox" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"machine_id" text,
	"workspace_path" text NOT NULL,
	"git_user_name" text NOT NULL,
	"git_user_email" text NOT NULL,
	"mailbox_status" "mailbox_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"message_id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"from_type" "actor_type" NOT NULL,
	"from_id" text NOT NULL,
	"to_type" "actor_type",
	"to_id" text,
	"body" text NOT NULL,
	"message_kind" "message_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"mailbox" text NOT NULL,
	"machine_id" text NOT NULL,
	"workspace_path" text NOT NULL,
	"session_status" "session_status" NOT NULL,
	"active_task_id" text,
	"last_processed_message_id" text,
	"latest_summary" text,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"task_id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"thread_id" text NOT NULL,
	"parent_task_id" text,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" text NOT NULL,
	"assignee_type" "actor_type" NOT NULL,
	"assignee_mailbox" text,
	"status" "task_status" DEFAULT 'new' NOT NULL,
	"requires_artifact" boolean DEFAULT false NOT NULL,
	"body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"thread_id" text PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" text NOT NULL,
	"assigned_mailbox" text NOT NULL,
	"thread_status" "thread_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_task_id_tasks_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("task_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_mailbox_mailboxes_mailbox_fk" FOREIGN KEY ("mailbox") REFERENCES "public"."mailboxes"("mailbox") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_machine_id_machines_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("machine_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_threads_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("thread_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_mailbox_mailboxes_mailbox_fk" FOREIGN KEY ("mailbox") REFERENCES "public"."mailboxes"("mailbox") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_machine_id_machines_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("machine_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_thread_id_threads_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("thread_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_mailbox_mailboxes_mailbox_fk" FOREIGN KEY ("assignee_mailbox") REFERENCES "public"."mailboxes"("mailbox") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_assigned_mailbox_mailboxes_mailbox_fk" FOREIGN KEY ("assigned_mailbox") REFERENCES "public"."mailboxes"("mailbox") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifacts_task_idx" ON "artifacts" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "machines_host_status_idx" ON "machines" USING btree ("host_status");--> statement-breakpoint
CREATE INDEX "mailboxes_machine_id_idx" ON "mailboxes" USING btree ("machine_id");--> statement-breakpoint
CREATE INDEX "messages_thread_created_idx" ON "messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_mailbox_idx" ON "sessions" USING btree ("mailbox");--> statement-breakpoint
CREATE INDEX "sessions_machine_id_idx" ON "sessions" USING btree ("machine_id");--> statement-breakpoint
CREATE INDEX "sessions_status_idx" ON "sessions" USING btree ("session_status");--> statement-breakpoint
CREATE INDEX "tasks_assignee_status_updated_idx" ON "tasks" USING btree ("assignee_mailbox","status","updated_at");--> statement-breakpoint
CREATE INDEX "tasks_parent_task_idx" ON "tasks" USING btree ("parent_task_id");--> statement-breakpoint
CREATE INDEX "tasks_thread_idx" ON "tasks" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "threads_assigned_mailbox_idx" ON "threads" USING btree ("assigned_mailbox");--> statement-breakpoint
CREATE INDEX "threads_updated_at_idx" ON "threads" USING btree ("updated_at");