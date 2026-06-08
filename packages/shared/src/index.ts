import { z } from "zod";

export const HOST_STATUSES = ["online", "offline", "degraded"] as const;
export const MAILBOX_STATUSES = ["active", "disabled", "unassigned"] as const;
export const SESSION_STATUSES = [
  "bootstrapping",
  "idle",
  "running",
  "waiting_human",
  "waiting_child",
  "failed",
  "cleared"
] as const;
export const THREAD_STATUSES = [
  "open",
  "waiting_human",
  "waiting_agent",
  "completed",
  "blocked"
] as const;
export const TASK_STATUSES = ["new", "in_progress", "paused", "done", "blocked"] as const;
export const MESSAGE_KINDS = [
  "human_mail",
  "agent_reply",
  "delegation_mail",
  "summary_mail",
  "system_note"
] as const;
export const ARTIFACT_TYPES = ["document", "script", "code", "config", "test", "other"] as const;
export const ACTOR_TYPES = ["human", "agent"] as const;

export const isoTimestampSchema = z.string().datetime({ offset: true });

export const machineSchema = z.object({
  machine_id: z.string().min(1),
  label: z.string().min(1),
  host_version: z.string().min(1).nullable(),
  host_status: z.enum(HOST_STATUSES),
  last_heartbeat_at: isoTimestampSchema,
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema
});

export const mailboxSchema = z.object({
  mailbox: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  machine_id: z.string().min(1).nullable(),
  workspace_path: z.string().min(1),
  git_user_name: z.string().min(1),
  git_user_email: z.string().email(),
  mailbox_status: z.enum(MAILBOX_STATUSES),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema
});

export const sessionSchema = z.object({
  session_id: z.string().min(1),
  mailbox: z.string().min(1),
  machine_id: z.string().min(1),
  workspace_path: z.string().min(1),
  session_status: z.enum(SESSION_STATUSES),
  active_task_id: z.string().min(1).nullable(),
  last_processed_message_id: z.string().min(1).nullable(),
  latest_summary: z.string().min(1).nullable(),
  last_heartbeat_at: isoTimestampSchema,
  started_at: isoTimestampSchema,
  cleared_at: isoTimestampSchema.nullable(),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema
});

export const threadSchema = z.object({
  thread_id: z.string().min(1),
  subject: z.string().min(1),
  created_by_type: z.enum(ACTOR_TYPES),
  created_by_id: z.string().min(1),
  assigned_mailbox: z.string().min(1),
  thread_status: z.enum(THREAD_STATUSES),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema
});

export const messageSchema = z.object({
  message_id: z.string().min(1),
  thread_id: z.string().min(1),
  from_type: z.enum(ACTOR_TYPES),
  from_id: z.string().min(1),
  to_type: z.enum(ACTOR_TYPES).nullable(),
  to_id: z.string().min(1).nullable(),
  body: z.string().min(1),
  message_kind: z.enum(MESSAGE_KINDS),
  created_at: isoTimestampSchema
});

export const taskSchema = z.object({
  task_id: z.string().min(1),
  title: z.string().min(1),
  thread_id: z.string().min(1),
  parent_task_id: z.string().min(1).nullable(),
  created_by_type: z.enum(ACTOR_TYPES),
  created_by_id: z.string().min(1),
  assignee_type: z.enum(ACTOR_TYPES),
  assignee_mailbox: z.string().min(1).nullable(),
  requires_artifact: z.boolean(),
  status: z.enum(TASK_STATUSES),
  body: z.string().min(1).nullable(),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema
});

export const artifactSchema = z.object({
  artifact_id: z.string().min(1),
  task_id: z.string().min(1),
  mailbox: z.string().min(1),
  artifact_type: z.enum(ARTIFACT_TYPES),
  path: z.string().min(1),
  branch: z.string().min(1).nullable(),
  commit_sha: z.string().min(1).nullable(),
  created_at: isoTimestampSchema
});

export const threadSummarySchema = threadSchema.extend({
  latest_message_at: isoTimestampSchema.nullable(),
  latest_message_preview: z.string().nullable(),
  open_task_count: z.number().int().nonnegative()
});

export const threadDetailSchema = z.object({
  thread: threadSchema,
  primary_task: taskSchema.nullable(),
  related_tasks: z.array(taskSchema),
  messages: z.array(messageSchema)
});

export const workPackageSchema = z.object({
  task: taskSchema,
  thread: threadSchema,
  latest_summary: z.string().nullable(),
  new_messages: z.array(messageSchema),
  open_child_tasks: z.array(taskSchema),
  recent_artifacts: z.array(artifactSchema)
});

export const registerMachineRequestSchema = z.object({
  machine_id: z.string().min(1),
  label: z.string().min(1),
  host_version: z.string().min(1).optional()
});

export const machineHeartbeatRequestSchema = z.object({
  host_status: z.enum(HOST_STATUSES)
});

export const registerMailboxRequestSchema = z.object({
  mailbox: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  machine_id: z.string().min(1),
  workspace_path: z.string().min(1),
  git_user_name: z.string().min(1),
  git_user_email: z.string().email()
});

export const bindSessionRequestSchema = z.object({
  session_id: z.string().min(1),
  mailbox: z.string().min(1),
  machine_id: z.string().min(1),
  workspace_path: z.string().min(1),
  session_status: z.enum(SESSION_STATUSES)
});

export const sessionHeartbeatRequestSchema = z.object({
  mailbox: z.string().min(1),
  session_status: z.enum(SESSION_STATUSES),
  active_task_id: z.string().min(1).nullable().optional(),
  last_processed_message_id: z.string().min(1).nullable().optional(),
  latest_summary: z.string().min(1).nullable().optional()
});

export const clearSessionRequestSchema = z.object({
  mailbox: z.string().min(1),
  requested_by: z.string().min(1),
  force: z.boolean().default(false)
});

export const createThreadRequestSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
  assigned_mailbox: z.string().min(1)
});

export const appendMessageRequestSchema = z.object({
  from_type: z.enum(ACTOR_TYPES),
  from_id: z.string().min(1),
  to_type: z.enum(ACTOR_TYPES).nullable().optional(),
  to_id: z.string().min(1).nullable().optional(),
  message_kind: z.enum(MESSAGE_KINDS),
  body: z.string().min(1)
});

export const listTasksQuerySchema = z.object({
  assignee_mailbox: z.string().min(1).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  thread_id: z.string().min(1).optional(),
  parent_task_id: z.string().min(1).optional()
});

export const createTaskRequestSchema = z.object({
  title: z.string().min(1),
  thread_id: z.string().min(1),
  parent_task_id: z.string().min(1).nullable().optional(),
  created_by_type: z.enum(ACTOR_TYPES),
  created_by_id: z.string().min(1),
  assignee_type: z.enum(ACTOR_TYPES),
  assignee_mailbox: z.string().min(1).nullable().optional(),
  requires_artifact: z.boolean(),
  status: z.enum(TASK_STATUSES).default("new"),
  body: z.string().min(1).nullable().optional()
});

export const updateTaskStatusRequestSchema = z.object({
  status: z.enum(TASK_STATUSES)
});

export const createArtifactRequestSchema = z.object({
  task_id: z.string().min(1),
  mailbox: z.string().min(1),
  artifact_type: z.enum(ARTIFACT_TYPES),
  path: z.string().min(1),
  branch: z.string().min(1).nullable().optional(),
  commit_sha: z.string().min(1).nullable().optional()
});

export const threadDeltaQuerySchema = z.object({
  after_message_id: z.string().min(1).optional()
});

export type Machine = z.infer<typeof machineSchema>;
export type Mailbox = z.infer<typeof mailboxSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Thread = z.infer<typeof threadSchema>;
export type Message = z.infer<typeof messageSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type ThreadSummary = z.infer<typeof threadSummarySchema>;
export type ThreadDetail = z.infer<typeof threadDetailSchema>;
export type WorkPackage = z.infer<typeof workPackageSchema>;
export type HostStatus = (typeof HOST_STATUSES)[number];
export type MailboxStatus = (typeof MAILBOX_STATUSES)[number];
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export type ThreadStatus = (typeof THREAD_STATUSES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type MessageKind = (typeof MESSAGE_KINDS)[number];
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];
export type ActorType = (typeof ACTOR_TYPES)[number];
