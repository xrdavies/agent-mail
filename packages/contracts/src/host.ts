import { z } from "zod";

import {
  addressObjectSchema,
  artifactInputSchema,
  bindingStatusSchema,
  bootstrapStatusSchema,
  emailKindSchema,
  hostEventLevelSchema,
  hostStatusSchema,
  identifierSchema,
  isoTimestampSchema,
  mailboxManagementStatusSchema,
  linkedResourceInputSchema,
  mailboxRuntimeStatusSchema,
  mailboxSchema,
  profileStatusSchema,
  taskMutableStatusSchema
} from "./primitives.js";
import {
  deliverySchema,
  emailSchema,
  hostSchema,
  taskSchema,
  threadSchema
} from "./models.js";

export const hostHealthResponseSchema = z.object({
  ok: z.literal(true)
});

export const hostStatusMailboxSchema = z.object({
  mailbox: mailboxSchema,
  mailbox_runtime_status: mailboxRuntimeStatusSchema,
  current_session_id: identifierSchema.nullable(),
  pending_unread_count: z.number().int().nonnegative()
});

export const hostStatusResponseSchema = z.object({
  host: hostSchema,
  managed_mailboxes: z.array(mailboxSchema),
  mailbox_status: z.array(hostStatusMailboxSchema)
});

export const hostMcpConfigResponseSchema = z.object({
  url: z.string().url(),
  command: z.string().min(1),
  json: z.object({
    mcpServers: z.record(
      z.object({
        url: z.string().url()
      })
    )
  }),
  toml: z.string().min(1)
});

export const bootstrapAgentInputSchema = z.object({
  mailbox: mailboxSchema,
  name: z.string().min(1),
  role: z.string().min(1),
  responsibilities: z.string().min(1),
  workspacePath: z.string().min(1)
});

export const bootstrapAgentOutputSchema = z.object({
  hostId: identifierSchema,
  mailbox: mailboxSchema,
  workspacePath: z.string().min(1),
  profileStatus: profileStatusSchema,
  bindingStatus: z.enum(["active", "inactive", "failed"])
});

export const mailboxToolInputSchema = z.object({
  mailbox: mailboxSchema
});

export const getOldestUnreadDeliveryOutputSchema = z
  .object({
    deliveryId: identifierSchema,
    emailId: identifierSchema,
    threadId: identifierSchema,
    recipientMailbox: mailboxSchema,
    readStatus: z.literal("unread"),
    createdAt: z.string().datetime({ offset: true }).or(z.string().datetime())
  })
  .nullable();

export const getDeliveryInputSchema = z.object({
  mailbox: mailboxSchema,
  deliveryId: identifierSchema
});

export const getDeliveryOutputSchema = z.object({
  deliveryId: identifierSchema,
  emailId: identifierSchema,
  threadId: identifierSchema,
  recipientAddress: z.string().min(1),
  recipientMailbox: mailboxSchema.nullable(),
  deliveryKind: z.enum(["to", "cc"]),
  readStatus: z.enum(["unread", "read"]),
  createdAt: z.string().datetime({ offset: true }).or(z.string().datetime())
});

export const getEmailInputSchema = z.object({
  mailbox: mailboxSchema,
  emailId: identifierSchema
});

export const getThreadInputSchema = z.object({
  mailbox: mailboxSchema,
  threadId: identifierSchema
});

export const threadToolOutputSchema = z.object({
  thread: threadSchema,
  emails: z.array(emailSchema),
  linked_resources: z.array(
    z.object({
      linked_resource_id: identifierSchema,
      email_id: identifierSchema,
      url: z.string().url(),
      title: z.string().nullable(),
      mime_type: z.string().nullable(),
      size_bytes: z.number().int().nonnegative().nullable(),
      created_at: z.string().datetime({ offset: true }).or(z.string().datetime())
    })
  ),
  tasks: z.array(taskSchema)
});

export const markDeliveryReadInputSchema = z.object({
  mailbox: mailboxSchema,
  deliveryId: identifierSchema
});

export const markDeliveryReadOutputSchema = z.object({
  ok: z.literal(true),
  deliveryId: identifierSchema,
  readStatus: z.literal("read"),
  readAt: z.string().datetime({ offset: true }).or(z.string().datetime())
});

export const sendEmailInputSchema = z.object({
  mailbox: mailboxSchema,
  to: z.array(addressObjectSchema).min(1).max(1),
  cc: z.array(addressObjectSchema).default([]),
  subject: z.string().min(1),
  bodyText: z.string().min(1),
  rawBody: z.string().min(1),
  inReplyTo: z.string().min(1).nullable().optional(),
  references: z.array(z.string().min(1)).default([]),
  linkedResources: z.array(linkedResourceInputSchema).default([]),
  emailKind: emailKindSchema.optional()
});

export const sendEmailOutputSchema = z.object({
  emailId: identifierSchema,
  threadId: identifierSchema,
  messageId: z.string().min(1)
});

export const createTaskInputSchema = z.object({
  mailbox: mailboxSchema,
  threadId: identifierSchema,
  triggerEmailId: identifierSchema,
  assigneeMailbox: mailboxSchema,
  title: z.string().min(1),
  instructions: z.string().nullable().optional(),
  parentTaskId: identifierSchema.nullable().optional(),
  requiresArtifact: z.boolean()
});

export const createTaskOutputSchema = z.object({
  taskId: identifierSchema,
  status: z.literal("new")
});

export const getTaskInputSchema = z.object({
  mailbox: mailboxSchema,
  taskId: identifierSchema
});

export const listTasksInputSchema = z.object({
  mailbox: mailboxSchema,
  threadId: identifierSchema.optional(),
  status: z.enum(["new", "in_progress", "paused", "done", "blocked"]).optional(),
  parentTaskId: identifierSchema.optional()
});

export const updateTaskStatusInputSchema = z.object({
  mailbox: mailboxSchema,
  taskId: identifierSchema,
  status: taskMutableStatusSchema,
  completedByEmailId: identifierSchema.nullable().optional(),
  artifacts: z.array(artifactInputSchema).optional()
});

export const listAgentsInputSchema = z.object({
  mailbox: mailboxSchema
});

export const listAgentsOutputSchema = z.array(
  z.object({
    mailbox: mailboxSchema,
    name: z.string().min(1),
    role: z.string().min(1),
    status: profileStatusSchema
  })
);

export const hostWebMailboxesQuerySchema = z.object({
  q: z.string().trim().min(1).optional()
});

export const hostWebAvailableActionsSchema = z.object({
  can_resume_now: z.boolean(),
  can_clear_failure: z.boolean(),
  can_enable: z.boolean(),
  can_disable: z.boolean(),
  can_remove_local_binding: z.boolean()
});

export const hostWebOverviewAttentionMailboxSchema = z.object({
  mailbox: mailboxSchema,
  name: z.string().nullable(),
  role: z.string().nullable(),
  management_status: mailboxManagementStatusSchema,
  binding_status: bindingStatusSchema,
  runtime_status: mailboxRuntimeStatusSchema,
  pending_unread_count: z.number().int().nonnegative(),
  last_error: z.string().nullable(),
  bootstrap_status: bootstrapStatusSchema,
  updated_at: isoTimestampSchema,
  available_actions: hostWebAvailableActionsSchema
});

export const hostWebOverviewResponseSchema = z.object({
  host: z.object({
    host_id: identifierSchema,
    label: z.string().min(1),
    host_version: z.string().min(1),
    host_status: hostStatusSchema,
    started_at: isoTimestampSchema
  }),
  auth: z.object({
    central_base_url: z.string().url(),
    authenticated: z.boolean(),
    last_authenticated_at: isoTimestampSchema.nullable(),
    last_heartbeat_at: isoTimestampSchema.nullable(),
    last_auth_error: z.string().nullable()
  }),
  mcp: hostMcpConfigResponseSchema,
  counters: z.object({
    managed_mailboxes: z.number().int().nonnegative(),
    enabled_mailboxes: z.number().int().nonnegative(),
    disabled_mailboxes: z.number().int().nonnegative(),
    running_mailboxes: z.number().int().nonnegative(),
    failed_mailboxes: z.number().int().nonnegative(),
    stuck_unread_mailboxes: z.number().int().nonnegative()
  }),
  attention_mailboxes: z.array(hostWebOverviewAttentionMailboxSchema)
});

export const hostWebMailboxSummarySchema = z.object({
  mailbox: mailboxSchema,
  name: z.string().nullable(),
  role: z.string().nullable(),
  binding_status: bindingStatusSchema,
  management_status: mailboxManagementStatusSchema,
  runtime_status: mailboxRuntimeStatusSchema,
  pending_unread_count: z.number().int().nonnegative(),
  current_session_id: identifierSchema.nullable(),
  bootstrap_status: bootstrapStatusSchema,
  updated_at: isoTimestampSchema,
  available_actions: hostWebAvailableActionsSchema
});

export const hostWebMailboxesResponseSchema = z.object({
  counters: z.object({
    total: z.number().int().nonnegative(),
    enabled: z.number().int().nonnegative(),
    disabled: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    with_unread: z.number().int().nonnegative()
  }),
  mailboxes: z.array(hostWebMailboxSummarySchema)
});

export const hostWebEventSchema = z.object({
  level: hostEventLevelSchema,
  title: z.string().min(1),
  message: z.string().nullable(),
  at: isoTimestampSchema
});

export const hostWebMailboxDetailResponseSchema = z.object({
  profile: z.object({
    mailbox: mailboxSchema,
    name: z.string().nullable(),
    role: z.string().nullable(),
    responsibilities: z.string().nullable()
  }),
  binding: z.object({
    host_id: identifierSchema,
    binding_status: bindingStatusSchema,
    bound_at: isoTimestampSchema.nullable()
  }),
  workspace: z.object({
    workspace_path: z.string().min(1),
    git_user_name: z.string().min(1),
    git_user_email: mailboxSchema
  }),
  bootstrap: z.object({
    bootstrap_status: bootstrapStatusSchema,
    last_bootstrap_at: isoTimestampSchema.nullable()
  }),
  runtime: z.object({
    management_status: mailboxManagementStatusSchema,
    runtime_status: mailboxRuntimeStatusSchema,
    current_session_id: identifierSchema.nullable(),
    active_task_id: identifierSchema.nullable(),
    pending_unread_count: z.number().int().nonnegative(),
    last_processed_delivery_id: identifierSchema.nullable(),
    latest_summary: z.string().nullable(),
    next_resume_after: isoTimestampSchema.nullable(),
    last_error: z.string().nullable(),
    last_error_at: isoTimestampSchema.nullable(),
    updated_at: isoTimestampSchema
  }),
  recovery: z.object({
    suggested_action: z.string().min(1)
  }),
  recent_events: z.array(hostWebEventSchema),
  available_actions: hostWebAvailableActionsSchema
});

export const hostWebHostReauthResponseSchema = z.object({
  ok: z.literal(true),
  host_status: hostStatusSchema,
  last_authenticated_at: isoTimestampSchema.nullable(),
  last_auth_error: z.string().nullable()
});

export const hostWebResumeMailboxResponseSchema = z.object({
  ok: z.literal(true),
  mailbox: mailboxSchema,
  accepted: z.boolean(),
  runtime_status: mailboxRuntimeStatusSchema
});

export const hostWebClearFailureResponseSchema = z.object({
  ok: z.literal(true),
  mailbox: mailboxSchema,
  runtime_status: mailboxRuntimeStatusSchema,
  failure_count: z.number().int().nonnegative(),
  next_resume_after: isoTimestampSchema.nullable(),
  last_error: z.string().nullable()
});

export const hostWebSetManagementStatusResponseSchema = z.object({
  ok: z.literal(true),
  mailbox: mailboxSchema,
  management_status: mailboxManagementStatusSchema
});

export const hostWebRemoveBindingResponseSchema = z.object({
  ok: z.literal(true),
  mailbox: mailboxSchema,
  binding_status: bindingStatusSchema,
  management_status: mailboxManagementStatusSchema
});

export type BootstrapAgentInput = z.infer<typeof bootstrapAgentInputSchema>;
export type SendEmailInput = z.infer<typeof sendEmailInputSchema>;
