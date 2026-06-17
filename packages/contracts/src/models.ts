import { z } from "zod";

import {
  addressObjectSchema,
  bindingStatusSchema,
  deliveryKindSchema,
  emailKindSchema,
  hostStatusSchema,
  identifierSchema,
  isoTimestampSchema,
  mailboxRuntimeStatusSchema,
  mailboxSchema,
  profileStatusSchema,
  rawHeadersSchema,
  readStatusSchema,
  sendStateSchema,
  taskStatusSchema,
  threadStatusSchema,
  tokenStatusSchema
} from "./primitives.js";

export const hostSchema = z.object({
  host_id: identifierSchema,
  label: z.string().min(1),
  host_version: z.string().min(1).nullable(),
  host_status: hostStatusSchema,
  last_heartbeat_at: isoTimestampSchema.nullable(),
  last_authenticated_at: isoTimestampSchema.nullable(),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema
});

export const hostTokenSchema = z.object({
  token_id: identifierSchema,
  host_id: identifierSchema,
  token_hash: z.string().min(1),
  token_status: tokenStatusSchema,
  issued_at: isoTimestampSchema,
  revoked_at: isoTimestampSchema.nullable(),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema
});

export const agentProfileSchema = z.object({
  agent_id: identifierSchema,
  mailbox: mailboxSchema,
  name: z.string().min(1),
  role: z.string().min(1),
  responsibilities: z.string().min(1),
  profile_status: profileStatusSchema,
  registered_by_host_id: identifierSchema,
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema,
  retired_at: isoTimestampSchema.nullable()
});

export const mailboxBindingSchema = z.object({
  binding_id: identifierSchema,
  agent_id: identifierSchema,
  mailbox: mailboxSchema,
  host_id: identifierSchema,
  workspace_path: z.string().min(1),
  git_user_name: z.string().min(1),
  git_user_email: mailboxSchema,
  binding_status: bindingStatusSchema,
  bound_at: isoTimestampSchema,
  unbound_at: isoTimestampSchema.nullable(),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema
});

export const mailboxRuntimeSchema = z.object({
  mailbox: mailboxSchema,
  host_id: identifierSchema,
  workspace_path: z.string().min(1),
  current_session_id: identifierSchema.nullable(),
  mailbox_runtime_status: mailboxRuntimeStatusSchema,
  active_task_id: identifierSchema.nullable(),
  last_processed_delivery_id: identifierSchema.nullable(),
  latest_summary: z.string().nullable(),
  last_heartbeat_at: isoTimestampSchema.nullable(),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema
});

export const threadSchema = z.object({
  thread_id: identifierSchema,
  root_email_id: identifierSchema,
  root_message_id: z.string().min(1),
  root_subject: z.string().min(1),
  latest_email_id: identifierSchema.nullable(),
  thread_status: threadStatusSchema,
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema
});

export const emailSchema = z.object({
  email_id: identifierSchema,
  message_id: z.string().min(1),
  thread_id: identifierSchema,
  from: addressObjectSchema,
  to: z.array(addressObjectSchema),
  cc: z.array(addressObjectSchema),
  subject: z.string().min(1),
  body_text: z.string().min(1),
  raw_body: z.string().min(1),
  raw_headers: rawHeadersSchema.nullable(),
  in_reply_to: z.string().min(1).nullable(),
  references: z.array(z.string().min(1)),
  email_kind: emailKindSchema,
  send_state: sendStateSchema,
  created_by_host_id: identifierSchema.nullable(),
  created_by_mailbox: mailboxSchema.nullable(),
  sent_at: isoTimestampSchema.nullable(),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema
});

export const deliverySchema = z.object({
  delivery_id: identifierSchema,
  email_id: identifierSchema,
  thread_id: identifierSchema,
  recipient_address: z.string().min(1),
  recipient_mailbox: mailboxSchema.nullable(),
  delivery_kind: deliveryKindSchema,
  read_status: readStatusSchema,
  read_at: isoTimestampSchema.nullable(),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema
});

export const taskSchema = z.object({
  task_id: identifierSchema,
  thread_id: identifierSchema,
  trigger_email_id: identifierSchema,
  parent_task_id: identifierSchema.nullable(),
  created_by_email_id: identifierSchema.nullable(),
  created_by_mailbox: mailboxSchema,
  assignee_mailbox: mailboxSchema,
  title: z.string().min(1),
  instructions: z.string().nullable(),
  requires_artifact: z.boolean(),
  status: taskStatusSchema,
  completed_by_email_id: identifierSchema.nullable(),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema
});

export const linkedResourceSchema = z.object({
  linked_resource_id: identifierSchema,
  email_id: identifierSchema,
  url: z.string().url(),
  title: z.string().nullable(),
  mime_type: z.string().nullable(),
  size_bytes: z.number().int().nonnegative().nullable(),
  created_at: isoTimestampSchema
});

export const artifactSchema = z.object({
  artifact_id: identifierSchema,
  task_id: identifierSchema,
  produced_by_mailbox: mailboxSchema,
  repository: z.string().nullable(),
  path: z.string().min(1),
  branch: z.string().nullable(),
  commit_sha: z.string().nullable(),
  pr_link: z.string().url().nullable(),
  created_at: isoTimestampSchema
});

export type Host = z.infer<typeof hostSchema>;
export type HostToken = z.infer<typeof hostTokenSchema>;
export type AgentProfile = z.infer<typeof agentProfileSchema>;
export type MailboxBinding = z.infer<typeof mailboxBindingSchema>;
export type MailboxRuntime = z.infer<typeof mailboxRuntimeSchema>;
export type Thread = z.infer<typeof threadSchema>;
export type Email = z.infer<typeof emailSchema>;
export type Delivery = z.infer<typeof deliverySchema>;
export type Task = z.infer<typeof taskSchema>;
export type LinkedResource = z.infer<typeof linkedResourceSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
