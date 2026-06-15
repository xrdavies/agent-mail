import { z } from "zod";

import {
  artifactInputSchema,
  emailKindSchema,
  hostStatusSchema,
  identifierSchema,
  isoTimestampSchema,
  linkedResourceInputSchema,
  mailboxRuntimeStatusSchema,
  mailboxSchema,
  taskMutableStatusSchema
} from "./primitives.js";
import {
  agentProfileSchema,
  deliverySchema,
  emailSchema,
  hostSchema,
  mailboxBindingSchema,
  mailboxRuntimeSchema,
  taskSchema,
  threadSchema,
  linkedResourceSchema,
  artifactSchema
} from "./models.js";

export const healthResponseSchema = z.object({
  ok: z.literal(true)
});

export const hostAuthExchangeRequestSchema = z.object({
  host_id: identifierSchema,
  label: z.string().min(1),
  bootstrap_key: z.string().min(1),
  host_version: z.string().min(1).nullable().optional()
});

export const hostAuthExchangeResponseSchema = z.object({
  host: hostSchema,
  host_token: z.string().min(1),
  token_type: z.literal("Bearer")
});

export const hostRegisterRequestSchema = z.object({
  host_id: identifierSchema,
  label: z.string().min(1),
  host_version: z.string().min(1).nullable().optional()
});

export const managedMailboxHeartbeatSchema = z.object({
  mailbox: mailboxSchema,
  binding_status: z.enum(["active", "inactive", "failed"]),
  mailbox_runtime_status: mailboxRuntimeStatusSchema,
  workspace_path: z.string().min(1).nullable().optional(),
  last_processed_delivery_id: identifierSchema.nullable().optional(),
  current_session_id: identifierSchema.nullable().optional(),
  active_task_id: identifierSchema.nullable().optional(),
  latest_summary: z.string().nullable().optional()
});

export const hostHeartbeatRequestSchema = z.object({
  host_status: hostStatusSchema,
  managed_mailboxes: z.array(managedMailboxHeartbeatSchema)
});

export const hostHeartbeatResponseSchema = z.object({
  ok: z.literal(true),
  last_heartbeat_at: z.string().datetime({ offset: true }).or(z.string().datetime())
});

export const issueIdempotencyKeyRequestSchema = z.object({
  host_id: identifierSchema,
  mailbox: mailboxSchema,
  action: z.enum(["send_email", "create_task"])
});

export const issueIdempotencyKeyResponseSchema = z.object({
  idempotency_key: z.string().min(1)
});

export const registerAgentRequestSchema = z.object({
  host_id: identifierSchema,
  mailbox: mailboxSchema,
  name: z.string().min(1),
  role: z.string().min(1),
  responsibilities: z.string().min(1),
  workspace_path: z.string().min(1),
  git_user_name: z.string().min(1),
  git_user_email: mailboxSchema
});

export const registerAgentResponseSchema = z.object({
  profile: agentProfileSchema,
  binding: mailboxBindingSchema
});

export const agentsListQuerySchema = z.object({
  include_retired: z.coerce.boolean().optional()
});

export const sendEmailRequestSchema = z.object({
  idempotency_key: z.string().min(1),
  mailbox: mailboxSchema,
  from: z.object({
    display_name: z.string().min(1),
    address: mailboxSchema
  }),
  to: z
    .array(
      z.object({
        display_name: z.string().min(1),
        address: mailboxSchema
      })
    )
    .min(1)
    .max(1),
  cc: z.array(
    z.object({
      display_name: z.string().min(1),
      address: mailboxSchema
    })
  ),
  subject: z.string().min(1),
  body_text: z.string().min(1),
  raw_body: z.string().min(1),
  raw_headers: z
    .object({
      from: z.string().min(1).optional(),
      to: z.string().min(1).optional(),
      cc: z.string().optional(),
      subject: z.string().min(1).optional()
    })
    .catchall(z.string())
    .nullable()
    .optional(),
  in_reply_to: z.string().min(1).nullable().optional(),
  references: z.array(z.string().min(1)).default([]),
  email_kind: emailKindSchema,
  linked_resources: z.array(linkedResourceInputSchema).default([])
});

export const sendEmailResponseSchema = z.object({
  email: emailSchema,
  deliveries: z.array(deliverySchema),
  thread: threadSchema
});

export const deliveriesListQuerySchema = z.object({
  read_status: z.enum(["unread", "read"]).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  order: z.enum(["oldest_first", "newest_first"]).optional()
});

export const unreadDeliveriesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  order: z.enum(["oldest_first", "newest_first"]).optional()
});

export const markDeliveryReadRequestSchema = z.object({
  mailbox: mailboxSchema
});

export const markDeliveryReadResponseSchema = z.object({
  ok: z.literal(true),
  delivery_id: identifierSchema,
  read_status: z.literal("read"),
  read_at: z.string().datetime({ offset: true }).or(z.string().datetime())
});

export const threadDetailResponseSchema = z.object({
  thread: threadSchema,
  emails: z.array(emailSchema),
  linked_resources: z.array(linkedResourceSchema),
  tasks: z.array(taskSchema)
});

export const createTaskRequestSchema = z.object({
  idempotency_key: z.string().min(1),
  mailbox: mailboxSchema,
  thread_id: identifierSchema,
  trigger_email_id: identifierSchema,
  parent_task_id: identifierSchema.nullable().optional(),
  assignee_mailbox: mailboxSchema,
  title: z.string().min(1),
  instructions: z.string().nullable().optional(),
  requires_artifact: z.boolean()
});

export const listTasksQuerySchema = z.object({
  assignee_mailbox: mailboxSchema.optional(),
  status: z.enum(["new", "in_progress", "paused", "done", "blocked"]).optional(),
  thread_id: identifierSchema.optional(),
  trigger_email_id: identifierSchema.optional(),
  parent_task_id: identifierSchema.optional()
});

export const updateTaskStatusRequestSchema = z.object({
  mailbox: mailboxSchema,
  status: taskMutableStatusSchema,
  completed_by_email_id: identifierSchema.nullable().optional(),
  artifacts: z.array(artifactInputSchema).optional()
});

export const runtimeSnapshotSchema = z.object({
  host: hostSchema,
  bindings: z.array(mailboxBindingSchema),
  runtimes: z.array(mailboxRuntimeSchema)
});

export const centralLogEventSchema = z.object({
  id: identifierSchema,
  ts: isoTimestampSchema,
  level: z.enum(["info", "error"]),
  event: z.string().min(1),
  request_id: identifierSchema.nullable(),
  method: z.string().min(1).nullable(),
  path: z.string().min(1).nullable(),
  status: z.number().int().nullable(),
  duration_ms: z.number().int().nonnegative().nullable(),
  auth_host_id: identifierSchema.nullable(),
  debug: z.boolean(),
  message: z.string().nullable(),
  stack: z.string().nullable()
});

export const debugLogsQuerySchema = z.object({
  tail: z.coerce.number().int().positive().max(500).optional(),
  errors_only: z.coerce.boolean().optional(),
  debug_only: z.coerce.boolean().optional(),
  host_id: identifierSchema.optional(),
  path: z.string().min(1).optional(),
  request_id: identifierSchema.optional()
});

export const debugLogsResponseSchema = z.object({
  events: z.array(centralLogEventSchema)
});

export type HostAuthExchangeRequest = z.infer<typeof hostAuthExchangeRequestSchema>;
export type HostRegisterRequest = z.infer<typeof hostRegisterRequestSchema>;
export type HostHeartbeatRequest = z.infer<typeof hostHeartbeatRequestSchema>;
export type RegisterAgentRequest = z.infer<typeof registerAgentRequestSchema>;
export type SendEmailRequest = z.infer<typeof sendEmailRequestSchema>;
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;
export type UpdateTaskStatusRequest = z.infer<typeof updateTaskStatusRequestSchema>;
export type CentralLogEvent = z.infer<typeof centralLogEventSchema>;
