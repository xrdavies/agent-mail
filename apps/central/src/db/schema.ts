import {
  ACTOR_TYPES,
  ARTIFACT_TYPES,
  HOST_STATUSES,
  MAILBOX_STATUSES,
  MESSAGE_KINDS,
  SESSION_STATUSES,
  TASK_STATUSES,
  THREAD_STATUSES
} from "../../../../packages/shared/src/index";
import { boolean, index, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { InferSelectModel } from "drizzle-orm";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const actorTypeEnum = pgEnum("actor_type", ACTOR_TYPES);
export const hostStatusEnum = pgEnum("host_status", HOST_STATUSES);
export const mailboxStatusEnum = pgEnum("mailbox_status", MAILBOX_STATUSES);
export const sessionStatusEnum = pgEnum("session_status", SESSION_STATUSES);
export const threadStatusEnum = pgEnum("thread_status", THREAD_STATUSES);
export const taskStatusEnum = pgEnum("task_status", TASK_STATUSES);
export const messageKindEnum = pgEnum("message_kind", MESSAGE_KINDS);
export const artifactTypeEnum = pgEnum("artifact_type", ARTIFACT_TYPES);

export const machines = pgTable(
  "machines",
  {
    machine_id: text("machine_id").primaryKey(),
    label: text("label").notNull(),
    host_version: text("host_version"),
    host_status: hostStatusEnum("host_status").notNull().default("online"),
    last_heartbeat_at: timestamptz("last_heartbeat_at").notNull().defaultNow(),
    created_at: timestamptz("created_at").notNull().defaultNow(),
    updated_at: timestamptz("updated_at").notNull().defaultNow()
  },
  (table) => [index("machines_host_status_idx").on(table.host_status)]
);

export const mailboxes = pgTable(
  "mailboxes",
  {
    mailbox: text("mailbox").primaryKey(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    machine_id: text("machine_id").references(() => machines.machine_id, { onDelete: "set null" }),
    workspace_path: text("workspace_path").notNull(),
    git_user_name: text("git_user_name").notNull(),
    git_user_email: text("git_user_email").notNull(),
    mailbox_status: mailboxStatusEnum("mailbox_status").notNull().default("active"),
    created_at: timestamptz("created_at").notNull().defaultNow(),
    updated_at: timestamptz("updated_at").notNull().defaultNow()
  },
  (table) => [index("mailboxes_machine_id_idx").on(table.machine_id)]
);

export const sessions = pgTable(
  "sessions",
  {
    session_id: text("session_id").primaryKey(),
    mailbox: text("mailbox")
      .notNull()
      .references(() => mailboxes.mailbox, { onDelete: "restrict" }),
    machine_id: text("machine_id")
      .notNull()
      .references(() => machines.machine_id, { onDelete: "restrict" }),
    workspace_path: text("workspace_path").notNull(),
    session_status: sessionStatusEnum("session_status").notNull(),
    active_task_id: text("active_task_id"),
    last_processed_message_id: text("last_processed_message_id"),
    latest_summary: text("latest_summary"),
    last_heartbeat_at: timestamptz("last_heartbeat_at").notNull().defaultNow(),
    started_at: timestamptz("started_at").notNull().defaultNow(),
    cleared_at: timestamptz("cleared_at"),
    created_at: timestamptz("created_at").notNull().defaultNow(),
    updated_at: timestamptz("updated_at").notNull().defaultNow()
  },
  (table) => [
    index("sessions_mailbox_idx").on(table.mailbox),
    index("sessions_machine_id_idx").on(table.machine_id),
    index("sessions_status_idx").on(table.session_status)
  ]
);

export const threads = pgTable(
  "threads",
  {
    thread_id: text("thread_id").primaryKey(),
    subject: text("subject").notNull(),
    created_by_type: actorTypeEnum("created_by_type").notNull(),
    created_by_id: text("created_by_id").notNull(),
    assigned_mailbox: text("assigned_mailbox")
      .notNull()
      .references(() => mailboxes.mailbox, { onDelete: "restrict" }),
    thread_status: threadStatusEnum("thread_status").notNull().default("open"),
    created_at: timestamptz("created_at").notNull().defaultNow(),
    updated_at: timestamptz("updated_at").notNull().defaultNow()
  },
  (table) => [
    index("threads_assigned_mailbox_idx").on(table.assigned_mailbox),
    index("threads_updated_at_idx").on(table.updated_at)
  ]
);

export const messages = pgTable(
  "messages",
  {
    message_id: text("message_id").primaryKey(),
    thread_id: text("thread_id")
      .notNull()
      .references(() => threads.thread_id, { onDelete: "cascade" }),
    from_type: actorTypeEnum("from_type").notNull(),
    from_id: text("from_id").notNull(),
    to_type: actorTypeEnum("to_type"),
    to_id: text("to_id"),
    body: text("body").notNull(),
    message_kind: messageKindEnum("message_kind").notNull(),
    created_at: timestamptz("created_at").notNull().defaultNow()
  },
  (table) => [index("messages_thread_created_idx").on(table.thread_id, table.created_at)]
);

export const tasks = pgTable(
  "tasks",
  {
    task_id: text("task_id").primaryKey(),
    title: text("title").notNull(),
    thread_id: text("thread_id")
      .notNull()
      .references(() => threads.thread_id, { onDelete: "cascade" }),
    parent_task_id: text("parent_task_id"),
    created_by_type: actorTypeEnum("created_by_type").notNull(),
    created_by_id: text("created_by_id").notNull(),
    assignee_type: actorTypeEnum("assignee_type").notNull(),
    assignee_mailbox: text("assignee_mailbox").references(() => mailboxes.mailbox, {
      onDelete: "set null"
    }),
    status: taskStatusEnum("status").notNull().default("new"),
    requires_artifact: boolean("requires_artifact").notNull().default(false),
    body: text("body"),
    created_at: timestamptz("created_at").notNull().defaultNow(),
    updated_at: timestamptz("updated_at").notNull().defaultNow()
  },
  (table) => [
    index("tasks_assignee_status_updated_idx").on(
      table.assignee_mailbox,
      table.status,
      table.updated_at
    ),
    index("tasks_parent_task_idx").on(table.parent_task_id),
    index("tasks_thread_idx").on(table.thread_id)
  ]
);

export const artifacts = pgTable(
  "artifacts",
  {
    artifact_id: text("artifact_id").primaryKey(),
    task_id: text("task_id")
      .notNull()
      .references(() => tasks.task_id, { onDelete: "cascade" }),
    mailbox: text("mailbox")
      .notNull()
      .references(() => mailboxes.mailbox, { onDelete: "restrict" }),
    repository: text("repository"),
    artifact_type: artifactTypeEnum("artifact_type").notNull(),
    path: text("path").notNull(),
    branch: text("branch"),
    commit_sha: text("commit_sha"),
    pr_link: text("pr_link"),
    created_at: timestamptz("created_at").notNull().defaultNow()
  },
  (table) => [index("artifacts_task_idx").on(table.task_id)]
);

export type MachineRow = InferSelectModel<typeof machines>;
export type MailboxRow = InferSelectModel<typeof mailboxes>;
export type SessionRow = InferSelectModel<typeof sessions>;
export type ThreadRow = InferSelectModel<typeof threads>;
export type MessageRow = InferSelectModel<typeof messages>;
export type TaskRow = InferSelectModel<typeof tasks>;
export type ArtifactRow = InferSelectModel<typeof artifacts>;
