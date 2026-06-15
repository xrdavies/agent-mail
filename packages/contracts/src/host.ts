import { z } from "zod";

import {
  addressObjectSchema,
  artifactInputSchema,
  emailKindSchema,
  identifierSchema,
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

export type BootstrapAgentInput = z.infer<typeof bootstrapAgentInputSchema>;
export type SendEmailInput = z.infer<typeof sendEmailInputSchema>;
