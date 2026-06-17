CREATE TABLE "agent_profiles" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"mailbox" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"responsibilities" text NOT NULL,
	"profile_status" text NOT NULL,
	"registered_by_host_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"artifact_id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"produced_by_mailbox" text NOT NULL,
	"repository" text,
	"path" text NOT NULL,
	"branch" text,
	"commit_sha" text,
	"pr_link" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"email_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"recipient_address" text NOT NULL,
	"recipient_mailbox" text,
	"delivery_kind" text NOT NULL,
	"read_status" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"email_id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"from_json" jsonb NOT NULL,
	"to_json" jsonb NOT NULL,
	"cc_json" jsonb NOT NULL,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"raw_body" text NOT NULL,
	"raw_headers_json" jsonb,
	"in_reply_to" text,
	"references_json" jsonb NOT NULL,
	"email_kind" text NOT NULL,
	"send_state" text NOT NULL,
	"created_by_host_id" text,
	"created_by_mailbox" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emails_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "host_tokens" (
	"token_id" text PRIMARY KEY NOT NULL,
	"host_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_status" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "hosts" (
	"host_id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"host_version" text,
	"host_status" text NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"last_authenticated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"idempotency_key" text PRIMARY KEY NOT NULL,
	"host_id" text NOT NULL,
	"mailbox" text NOT NULL,
	"action" text NOT NULL,
	"consumed_at" timestamp with time zone,
	"resource_type" text,
	"resource_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "linked_resources" (
	"linked_resource_id" text PRIMARY KEY NOT NULL,
	"email_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"mime_type" text,
	"size_bytes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailbox_bindings" (
	"binding_id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"mailbox" text NOT NULL,
	"host_id" text NOT NULL,
	"workspace_path" text NOT NULL,
	"git_user_name" text NOT NULL,
	"git_user_email" text NOT NULL,
	"binding_status" text NOT NULL,
	"bound_at" timestamp with time zone NOT NULL,
	"unbound_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailbox_runtimes" (
	"mailbox" text PRIMARY KEY NOT NULL,
	"host_id" text NOT NULL,
	"workspace_path" text NOT NULL,
	"current_session_id" text,
	"mailbox_runtime_status" text NOT NULL,
	"active_task_id" text,
	"last_processed_delivery_id" text,
	"latest_summary" text,
	"last_heartbeat_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"task_id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"trigger_email_id" text NOT NULL,
	"parent_task_id" text,
	"created_by_email_id" text,
	"created_by_mailbox" text NOT NULL,
	"assignee_mailbox" text NOT NULL,
	"title" text NOT NULL,
	"instructions" text,
	"requires_artifact" boolean NOT NULL,
	"status" text NOT NULL,
	"completed_by_email_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"thread_id" text PRIMARY KEY NOT NULL,
	"root_email_id" text,
	"root_message_id" text NOT NULL,
	"root_subject" text NOT NULL,
	"latest_email_id" text,
	"thread_status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "threads_root_message_id_unique" UNIQUE("root_message_id")
);
--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_registered_by_host_id_hosts_host_id_fk" FOREIGN KEY ("registered_by_host_id") REFERENCES "public"."hosts"("host_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_task_id_tasks_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("task_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_email_id_emails_email_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("email_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_thread_id_threads_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("thread_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_thread_id_threads_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("thread_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_created_by_host_id_hosts_host_id_fk" FOREIGN KEY ("created_by_host_id") REFERENCES "public"."hosts"("host_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_tokens" ADD CONSTRAINT "host_tokens_host_id_hosts_host_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("host_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_host_id_hosts_host_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("host_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linked_resources" ADD CONSTRAINT "linked_resources_email_id_emails_email_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("email_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_bindings" ADD CONSTRAINT "mailbox_bindings_agent_id_agent_profiles_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_profiles"("agent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_bindings" ADD CONSTRAINT "mailbox_bindings_host_id_hosts_host_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("host_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_runtimes" ADD CONSTRAINT "mailbox_runtimes_host_id_hosts_host_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("host_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_thread_id_threads_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("thread_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_trigger_email_id_emails_email_id_fk" FOREIGN KEY ("trigger_email_id") REFERENCES "public"."emails"("email_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_email_id_emails_email_id_fk" FOREIGN KEY ("created_by_email_id") REFERENCES "public"."emails"("email_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_email_id_emails_email_id_fk" FOREIGN KEY ("completed_by_email_id") REFERENCES "public"."emails"("email_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_profiles_mailbox_status_idx" ON "agent_profiles" USING btree ("mailbox","profile_status");--> statement-breakpoint
CREATE INDEX "artifacts_task_idx" ON "artifacts" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "deliveries_mailbox_read_created_idx" ON "deliveries" USING btree ("recipient_mailbox","read_status","created_at");--> statement-breakpoint
CREATE INDEX "emails_message_idx" ON "emails" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "emails_thread_created_idx" ON "emails" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "host_tokens_host_status_idx" ON "host_tokens" USING btree ("host_id","token_status");--> statement-breakpoint
CREATE INDEX "hosts_last_heartbeat_idx" ON "hosts" USING btree ("last_heartbeat_at");--> statement-breakpoint
CREATE INDEX "linked_resources_email_idx" ON "linked_resources" USING btree ("email_id");--> statement-breakpoint
CREATE INDEX "mailbox_bindings_host_status_idx" ON "mailbox_bindings" USING btree ("host_id","binding_status");--> statement-breakpoint
CREATE INDEX "mailbox_bindings_mailbox_status_idx" ON "mailbox_bindings" USING btree ("mailbox","binding_status");--> statement-breakpoint
CREATE INDEX "mailbox_runtimes_mailbox_status_idx" ON "mailbox_runtimes" USING btree ("mailbox","mailbox_runtime_status");--> statement-breakpoint
CREATE INDEX "tasks_assignee_status_updated_idx" ON "tasks" USING btree ("assignee_mailbox","status","updated_at");--> statement-breakpoint
CREATE INDEX "tasks_thread_idx" ON "tasks" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "tasks_trigger_email_idx" ON "tasks" USING btree ("trigger_email_id");--> statement-breakpoint
CREATE INDEX "threads_root_message_idx" ON "threads" USING btree ("root_message_id");