import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp
} from "drizzle-orm/pg-core";

import type { AddressObject } from "@agent-mail/contracts";

export const hosts = pgTable(
  "hosts",
  {
    hostId: text("host_id").primaryKey(),
    label: text("label").notNull(),
    hostVersion: text("host_version"),
    hostStatus: text("host_status").notNull(),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    lastAuthenticatedAt: timestamp("last_authenticated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    heartbeatIdx: index("hosts_last_heartbeat_idx").on(table.lastHeartbeatAt)
  })
);

export const hostTokens = pgTable(
  "host_tokens",
  {
    tokenId: text("token_id").primaryKey(),
    hostId: text("host_id")
      .notNull()
      .references(() => hosts.hostId, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    tokenStatus: text("token_status").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    hostStatusIdx: index("host_tokens_host_status_idx").on(table.hostId, table.tokenStatus)
  })
);

export const agentProfiles = pgTable(
  "agent_profiles",
  {
    agentId: text("agent_id").primaryKey(),
    mailbox: text("mailbox").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    responsibilities: text("responsibilities").notNull(),
    profileStatus: text("profile_status").notNull(),
    registeredByHostId: text("registered_by_host_id")
      .notNull()
      .references(() => hosts.hostId),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    retiredAt: timestamp("retired_at", { withTimezone: true })
  },
  (table) => ({
    mailboxStatusIdx: index("agent_profiles_mailbox_status_idx").on(
      table.mailbox,
      table.profileStatus
    )
  })
);

export const mailboxBindings = pgTable(
  "mailbox_bindings",
  {
    bindingId: text("binding_id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agentProfiles.agentId),
    mailbox: text("mailbox").notNull(),
    hostId: text("host_id")
      .notNull()
      .references(() => hosts.hostId),
    workspacePath: text("workspace_path").notNull(),
    gitUserName: text("git_user_name").notNull(),
    gitUserEmail: text("git_user_email").notNull(),
    bindingStatus: text("binding_status").notNull(),
    boundAt: timestamp("bound_at", { withTimezone: true }).notNull(),
    unboundAt: timestamp("unbound_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    hostStatusIdx: index("mailbox_bindings_host_status_idx").on(
      table.hostId,
      table.bindingStatus
    ),
    mailboxStatusIdx: index("mailbox_bindings_mailbox_status_idx").on(
      table.mailbox,
      table.bindingStatus
    )
  })
);

export const mailboxRuntimes = pgTable(
  "mailbox_runtimes",
  {
    mailbox: text("mailbox").primaryKey(),
    hostId: text("host_id")
      .notNull()
      .references(() => hosts.hostId),
    workspacePath: text("workspace_path").notNull(),
    currentSessionId: text("current_session_id"),
    mailboxRuntimeStatus: text("mailbox_runtime_status").notNull(),
    activeTaskId: text("active_task_id"),
    lastProcessedDeliveryId: text("last_processed_delivery_id"),
    latestSummary: text("latest_summary"),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    mailboxStatusIdx: index("mailbox_runtimes_mailbox_status_idx").on(
      table.mailbox,
      table.mailboxRuntimeStatus
    )
  })
);

export const threads = pgTable(
  "threads",
  {
    threadId: text("thread_id").primaryKey(),
    rootEmailId: text("root_email_id"),
    rootMessageId: text("root_message_id").notNull().unique(),
    rootSubject: text("root_subject").notNull(),
    latestEmailId: text("latest_email_id"),
    threadStatus: text("thread_status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    rootMessageIdx: index("threads_root_message_idx").on(table.rootMessageId)
  })
);

export const emails = pgTable(
  "emails",
  {
    emailId: text("email_id").primaryKey(),
    messageId: text("message_id").notNull().unique(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.threadId),
    fromJson: jsonb("from_json").$type<AddressObject>().notNull(),
    toJson: jsonb("to_json").$type<AddressObject[]>().notNull(),
    ccJson: jsonb("cc_json").$type<AddressObject[]>().notNull(),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    rawBody: text("raw_body").notNull(),
    rawHeadersJson: jsonb("raw_headers_json").$type<Record<string, string> | null>(),
    inReplyTo: text("in_reply_to"),
    referencesJson: jsonb("references_json").$type<string[]>().notNull(),
    emailKind: text("email_kind").notNull(),
    sendState: text("send_state").notNull(),
    createdByHostId: text("created_by_host_id").references(() => hosts.hostId),
    createdByMailbox: text("created_by_mailbox"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    messageIdx: index("emails_message_idx").on(table.messageId),
    threadCreatedIdx: index("emails_thread_created_idx").on(table.threadId, table.createdAt)
  })
);

export const deliveries = pgTable(
  "deliveries",
  {
    deliveryId: text("delivery_id").primaryKey(),
    emailId: text("email_id")
      .notNull()
      .references(() => emails.emailId, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.threadId, { onDelete: "cascade" }),
    recipientAddress: text("recipient_address").notNull(),
    recipientMailbox: text("recipient_mailbox"),
    deliveryKind: text("delivery_kind").notNull(),
    readStatus: text("read_status").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    mailboxReadCreatedIdx: index("deliveries_mailbox_read_created_idx").on(
      table.recipientMailbox,
      table.readStatus,
      table.createdAt
    )
  })
);

export const tasks = pgTable(
  "tasks",
  {
    taskId: text("task_id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.threadId),
    triggerEmailId: text("trigger_email_id")
      .notNull()
      .references(() => emails.emailId),
    parentTaskId: text("parent_task_id"),
    createdByEmailId: text("created_by_email_id").references(() => emails.emailId),
    createdByMailbox: text("created_by_mailbox").notNull(),
    assigneeMailbox: text("assignee_mailbox").notNull(),
    title: text("title").notNull(),
    instructions: text("instructions"),
    requiresArtifact: boolean("requires_artifact").notNull(),
    status: text("status").notNull(),
    completedByEmailId: text("completed_by_email_id").references(() => emails.emailId),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    assigneeStatusUpdatedIdx: index("tasks_assignee_status_updated_idx").on(
      table.assigneeMailbox,
      table.status,
      table.updatedAt
    ),
    threadIdx: index("tasks_thread_idx").on(table.threadId),
    triggerEmailIdx: index("tasks_trigger_email_idx").on(table.triggerEmailId)
  })
);

export const linkedResources = pgTable(
  "linked_resources",
  {
    linkedResourceId: text("linked_resource_id").primaryKey(),
    emailId: text("email_id")
      .notNull()
      .references(() => emails.emailId, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    emailIdx: index("linked_resources_email_idx").on(table.emailId)
  })
);

export const artifacts = pgTable(
  "artifacts",
  {
    artifactId: text("artifact_id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.taskId, { onDelete: "cascade" }),
    producedByMailbox: text("produced_by_mailbox").notNull(),
    repository: text("repository"),
    path: text("path").notNull(),
    branch: text("branch"),
    commitSha: text("commit_sha"),
    prLink: text("pr_link"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    taskIdx: index("artifacts_task_idx").on(table.taskId)
  })
);

export const idempotencyKeys = pgTable("idempotency_keys", {
  idempotencyKey: text("idempotency_key").primaryKey(),
  hostId: text("host_id")
    .notNull()
    .references(() => hosts.hostId, { onDelete: "cascade" }),
  mailbox: text("mailbox").notNull(),
  action: text("action").notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const hostRelations = relations(hosts, ({ many }) => ({
  tokens: many(hostTokens),
  profiles: many(agentProfiles),
  bindings: many(mailboxBindings),
  runtimes: many(mailboxRuntimes),
  emails: many(emails)
}));

export const schema = {
  hosts,
  hostTokens,
  agentProfiles,
  mailboxBindings,
  mailboxRuntimes,
  threads,
  emails,
  deliveries,
  tasks,
  linkedResources,
  artifacts,
  idempotencyKeys
};

export const updateNow = sql`now()`;
