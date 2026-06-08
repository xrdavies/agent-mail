import {
  appendMessageRequestSchema,
  artifactSchema,
  bindSessionRequestSchema,
  clearSessionRequestSchema,
  createArtifactRequestSchema,
  createTaskRequestSchema,
  createThreadRequestSchema,
  listTasksQuerySchema,
  machineHeartbeatRequestSchema,
  mailboxSchema,
  machineSchema,
  messageSchema,
  registerMailboxRequestSchema,
  registerMachineRequestSchema,
  sessionHeartbeatRequestSchema,
  sessionSchema,
  taskSchema,
  threadDeltaQuerySchema,
  threadDetailSchema,
  threadSchema,
  threadSummarySchema,
  updateTaskStatusRequestSchema,
  workPackageSchema
} from "@agent-mail/shared";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";
import type { z } from "zod";

import { ApiError } from "./errors.js";
import {
  artifacts,
  type ArtifactRow,
  mailboxes,
  type MailboxRow,
  machines,
  type MachineRow,
  messages,
  type MessageRow,
  sessions,
  type SessionRow,
  tasks,
  type TaskRow,
  threads,
  type ThreadRow
} from "./db/schema.js";

type Database = {
  select: (...args: any[]) => any;
  insert: (...args: any[]) => any;
  update: (...args: any[]) => any;
  delete: (...args: any[]) => any;
  transaction: <T>(callback: (tx: Database) => Promise<T>) => Promise<T>;
};

const toIso = (value: Date | null | undefined) => (value ? value.toISOString() : null);
const createId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
const now = () => new Date();

const serializeMachine = (row: MachineRow) =>
  machineSchema.parse({
    ...row,
    host_version: row.host_version ?? null,
    last_heartbeat_at: row.last_heartbeat_at.toISOString(),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString()
  });

const serializeMailbox = (row: MailboxRow) =>
  mailboxSchema.parse({
    ...row,
    machine_id: row.machine_id ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString()
  });

const serializeSession = (row: SessionRow) =>
  sessionSchema.parse({
    ...row,
    active_task_id: row.active_task_id ?? null,
    last_processed_message_id: row.last_processed_message_id ?? null,
    latest_summary: row.latest_summary ?? null,
    last_heartbeat_at: row.last_heartbeat_at.toISOString(),
    started_at: row.started_at.toISOString(),
    cleared_at: toIso(row.cleared_at),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString()
  });

const serializeThread = (row: ThreadRow) =>
  threadSchema.parse({
    ...row,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString()
  });

const serializeMessage = (row: MessageRow) =>
  messageSchema.parse({
    ...row,
    to_type: row.to_type ?? null,
    to_id: row.to_id ?? null,
    created_at: row.created_at.toISOString()
  });

const serializeTask = (row: TaskRow) =>
  taskSchema.parse({
    ...row,
    parent_task_id: row.parent_task_id ?? null,
    assignee_mailbox: row.assignee_mailbox ?? null,
    body: row.body ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString()
  });

const serializeArtifact = (row: ArtifactRow) =>
  artifactSchema.parse({
    ...row,
    branch: row.branch ?? null,
    commit_sha: row.commit_sha ?? null,
    created_at: row.created_at.toISOString()
  });

const parseJson = async <T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.output<T>> => {
  let body: unknown;

  try {
    body = await c.req.json();
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON.");
  }

  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    throw new ApiError(400, "invalid_request", "Request payload is invalid.", parsed.error.flatten());
  }

  return parsed.data;
};

const parseQuery = <T extends z.ZodTypeAny>(c: Context, schema: T): z.output<T> => {
  const parsed = schema.safeParse(c.req.query());

  if (!parsed.success) {
    throw new ApiError(400, "invalid_query", "Query string is invalid.", parsed.error.flatten());
  }

  return parsed.data;
};

const getMachine = async (db: Database, machine_id: string) => {
  const [machine] = await db
    .select()
    .from(machines)
    .where(eq(machines.machine_id, machine_id))
    .limit(1);

  if (!machine) {
    throw new ApiError(404, "machine_not_found", `Unknown machine: ${machine_id}`);
  }

  return machine as MachineRow;
};

const getMailbox = async (db: Database, mailbox: string) => {
  const [record] = await db
    .select()
    .from(mailboxes)
    .where(eq(mailboxes.mailbox, mailbox))
    .limit(1);

  if (!record) {
    throw new ApiError(404, "mailbox_not_found", `Unknown mailbox: ${mailbox}`);
  }

  return record as MailboxRow;
};

const getSession = async (db: Database, session_id: string) => {
  const [record] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.session_id, session_id))
    .limit(1);

  if (!record) {
    throw new ApiError(404, "session_not_found", `Unknown session: ${session_id}`);
  }

  return record as SessionRow;
};

const getThread = async (db: Database, thread_id: string) => {
  const [record] = await db
    .select()
    .from(threads)
    .where(eq(threads.thread_id, thread_id))
    .limit(1);

  if (!record) {
    throw new ApiError(404, "thread_not_found", `Unknown thread: ${thread_id}`);
  }

  return record as ThreadRow;
};

const getMessageRows = async (db: Database, thread_id: string) =>
  (await db
    .select()
    .from(messages)
    .where(eq(messages.thread_id, thread_id))
    .orderBy(asc(messages.created_at))) as MessageRow[];

const getTask = async (db: Database, task_id: string) => {
  const [record] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.task_id, task_id))
    .limit(1);

  if (!record) {
    throw new ApiError(404, "task_not_found", `Unknown task: ${task_id}`);
  }

  return record as TaskRow;
};

const getActiveSessionForMailbox = async (db: Database, mailbox: string) => {
  const [record] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.mailbox, mailbox), ne(sessions.session_status, "cleared")))
    .orderBy(desc(sessions.updated_at))
    .limit(1);

  return (record ?? null) as SessionRow | null;
};

const getThreadMessagesAfter = async (db: Database, thread_id: string, after_message_id?: string) => {
  const rows = await getMessageRows(db, thread_id);

  if (!after_message_id) {
    return rows;
  }

  const cursor = rows.findIndex((row) => row.message_id === after_message_id);

  if (cursor === -1) {
    throw new ApiError(
      404,
      "message_not_found",
      `Message ${after_message_id} does not belong to thread ${thread_id}.`
    );
  }

  return rows.slice(cursor + 1);
};

const getThreadDetail = async (db: Database, thread_id: string) => {
  const thread = await getThread(db, thread_id);
  const related_tasks = ((await db
    .select()
    .from(tasks)
    .where(eq(tasks.thread_id, thread_id))
    .orderBy(asc(tasks.created_at))) ?? []) as TaskRow[];
  const messages_for_thread = await getMessageRows(db, thread_id);
  const primary_task = related_tasks.find((task) => task.parent_task_id === null) ?? null;

  return threadDetailSchema.parse({
    thread: serializeThread(thread),
    primary_task: primary_task ? serializeTask(primary_task) : null,
    related_tasks: related_tasks.map(serializeTask),
    messages: messages_for_thread.map(serializeMessage)
  });
};

const getThreadSummary = async (db: Database, thread: ThreadRow) => {
  const thread_messages = await getMessageRows(db, thread.thread_id);
  const thread_tasks = ((await db
    .select()
    .from(tasks)
    .where(eq(tasks.thread_id, thread.thread_id))
    .orderBy(desc(tasks.updated_at))) ?? []) as TaskRow[];
  const latest_message = thread_messages.at(-1) ?? null;
  const open_task_count = thread_tasks.filter((task) => task.status !== "done").length;

  return threadSummarySchema.parse({
    ...serializeThread(thread),
    latest_message_at: latest_message ? latest_message.created_at.toISOString() : null,
    latest_message_preview: latest_message ? latest_message.body.slice(0, 160) : null,
    open_task_count
  });
};

const assertMailboxExistsForAgentTask = async (
  db: Database,
  assignee_type: "human" | "agent",
  assignee_mailbox: string | null | undefined
) => {
  if (assignee_type === "agent") {
    if (!assignee_mailbox) {
      throw new ApiError(422, "assignee_mailbox_required", "Agent tasks require assignee_mailbox.");
    }

    await getMailbox(db, assignee_mailbox);
  }
};

const maybeAssertTaskArtifactCompletion = async (db: Database, task: TaskRow, nextStatus: string) => {
  if (nextStatus !== "done" || !task.requires_artifact) {
    return;
  }

  const existingArtifacts = ((await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.task_id, task.task_id))
    .limit(1)) ?? []) as ArtifactRow[];

  if (existingArtifacts.length === 0) {
    throw new ApiError(
      422,
      "artifact_required",
      `Task ${task.task_id} requires at least one artifact before it can be marked done.`
    );
  }
};

export const createApp = (db: Database) => {
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json(
        {
          error: {
            code: error.code,
            message: error.message,
            details: error.details ?? null
          }
        },
        error.status
      );
    }

    console.error(error);

    return c.json(
      {
        error: {
          code: "internal_error",
          message: "Unexpected server error."
        }
      },
      500
    );
  });

  app.get("/api/v1/health", (c) => c.json({ ok: true }));

  app.post("/api/v1/machines/register", async (c) => {
    const payload = await parseJson(c, registerMachineRequestSchema);
    const heartbeat_at = now();
    const updated_at = now();

    const [record] = await db
      .insert(machines)
      .values({
        ...payload,
        host_status: "online",
        last_heartbeat_at: heartbeat_at,
        created_at: updated_at,
        updated_at
      })
      .onConflictDoUpdate({
        target: machines.machine_id,
        set: {
          label: payload.label,
          host_version: payload.host_version ?? null,
          host_status: "online",
          last_heartbeat_at: heartbeat_at,
          updated_at
        }
      })
      .returning();

    return c.json(serializeMachine(record as MachineRow));
  });

  app.post("/api/v1/machines/:machine_id/heartbeat", async (c) => {
    const payload = await parseJson(c, machineHeartbeatRequestSchema);
    await getMachine(db, c.req.param("machine_id"));
    const last_heartbeat_at = now();

    const [record] = await db
      .update(machines)
      .set({
        host_status: payload.host_status,
        last_heartbeat_at,
        updated_at: last_heartbeat_at
      })
      .where(eq(machines.machine_id, c.req.param("machine_id")))
      .returning();

    return c.json({
      ok: true,
      last_heartbeat_at: (record as MachineRow).last_heartbeat_at.toISOString()
    });
  });

  app.get("/api/v1/machines", async (c) => {
    const records = ((await db.select().from(machines).orderBy(asc(machines.label))) ?? []) as MachineRow[];
    return c.json(records.map(serializeMachine));
  });

  app.post("/api/v1/mailboxes/register", async (c) => {
    const payload = await parseJson(c, registerMailboxRequestSchema);
    await getMachine(db, payload.machine_id);
    const timestamp = now();

    const [record] = await db
      .insert(mailboxes)
      .values({
        ...payload,
        mailbox_status: "active",
        created_at: timestamp,
        updated_at: timestamp
      })
      .onConflictDoUpdate({
        target: mailboxes.mailbox,
        set: {
          name: payload.name,
          role: payload.role,
          machine_id: payload.machine_id,
          workspace_path: payload.workspace_path,
          git_user_name: payload.git_user_name,
          git_user_email: payload.git_user_email,
          mailbox_status: "active",
          updated_at: timestamp
        }
      })
      .returning();

    return c.json(serializeMailbox(record as MailboxRow));
  });

  app.get("/api/v1/mailboxes", async (c) => {
    const records = ((await db.select().from(mailboxes).orderBy(asc(mailboxes.mailbox))) ?? []) as MailboxRow[];
    return c.json(records.map(serializeMailbox));
  });

  app.get("/api/v1/mailboxes/:mailbox", async (c) => {
    return c.json(serializeMailbox(await getMailbox(db, c.req.param("mailbox"))));
  });

  app.get("/api/v1/agents", async (c) => {
    const records = ((await db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.mailbox_status, "active"))
      .orderBy(asc(mailboxes.role), asc(mailboxes.mailbox))) ?? []) as MailboxRow[];

    return c.json(records.map(serializeMailbox));
  });

  app.post("/api/v1/sessions/bind", async (c) => {
    const payload = await parseJson(c, bindSessionRequestSchema);
    const mailbox = await getMailbox(db, payload.mailbox);
    await getMachine(db, payload.machine_id);

    if (mailbox.machine_id && mailbox.machine_id !== payload.machine_id) {
      throw new ApiError(
        409,
        "mailbox_machine_conflict",
        `Mailbox ${payload.mailbox} is assigned to ${mailbox.machine_id}, not ${payload.machine_id}.`
      );
    }

    const activeSession = await getActiveSessionForMailbox(db, payload.mailbox);

    if (activeSession && activeSession.session_id !== payload.session_id) {
      throw new ApiError(
        409,
        "active_session_conflict",
        `Mailbox ${payload.mailbox} already has an active session: ${activeSession.session_id}.`
      );
    }

    const existingSession = await db
      .select()
      .from(sessions)
      .where(eq(sessions.session_id, payload.session_id))
      .limit(1);

    if (existingSession[0] && existingSession[0].mailbox !== payload.mailbox) {
      throw new ApiError(
        409,
        "session_mailbox_conflict",
        `Session ${payload.session_id} is already bound to ${existingSession[0].mailbox}.`
      );
    }

    const timestamp = now();

    const [record] = await db
      .insert(sessions)
      .values({
        ...payload,
        last_heartbeat_at: timestamp,
        started_at: timestamp,
        created_at: timestamp,
        updated_at: timestamp
      })
      .onConflictDoUpdate({
        target: sessions.session_id,
        set: {
          mailbox: payload.mailbox,
          machine_id: payload.machine_id,
          workspace_path: payload.workspace_path,
          session_status: payload.session_status,
          last_heartbeat_at: timestamp,
          updated_at: timestamp,
          cleared_at: null
        }
      })
      .returning();

    return c.json(serializeSession(record as SessionRow));
  });

  app.post("/api/v1/sessions/:session_id/heartbeat", async (c) => {
    const payload = await parseJson(c, sessionHeartbeatRequestSchema);
    const session = await getSession(db, c.req.param("session_id"));

    if (session.session_status === "cleared") {
      throw new ApiError(
        409,
        "session_cleared",
        `Session ${session.session_id} has been cleared and cannot receive heartbeats.`
      );
    }

    if (session.mailbox !== payload.mailbox) {
      throw new ApiError(
        409,
        "session_mailbox_mismatch",
        `Session ${session.session_id} does not belong to ${payload.mailbox}.`
      );
    }

    if (payload.active_task_id) {
      await getTask(db, payload.active_task_id);
    }

    if (payload.last_processed_message_id) {
      const [message] = await db
        .select()
        .from(messages)
        .where(eq(messages.message_id, payload.last_processed_message_id))
        .limit(1);

      if (!message) {
        throw new ApiError(
          404,
          "message_not_found",
          `Unknown message: ${payload.last_processed_message_id}`
        );
      }
    }

    const heartbeat_at = now();

    const [record] = await db
      .update(sessions)
      .set({
        session_status: payload.session_status,
        active_task_id: payload.active_task_id ?? null,
        last_processed_message_id: payload.last_processed_message_id ?? null,
        latest_summary: payload.latest_summary ?? null,
        last_heartbeat_at: heartbeat_at,
        updated_at: heartbeat_at
      })
      .where(eq(sessions.session_id, session.session_id))
      .returning();

    return c.json({
      ok: true,
      last_heartbeat_at: (record as SessionRow).last_heartbeat_at.toISOString()
    });
  });

  app.get("/api/v1/sessions", async (c) => {
    const records = ((await db.select().from(sessions).orderBy(desc(sessions.updated_at))) ?? []) as SessionRow[];
    return c.json(records.map(serializeSession));
  });

  app.get("/api/v1/sessions/:session_id", async (c) => {
    return c.json(serializeSession(await getSession(db, c.req.param("session_id"))));
  });

  app.post("/api/v1/sessions/:session_id/clear", async (c) => {
    const payload = await parseJson(c, clearSessionRequestSchema);
    const session = await getSession(db, c.req.param("session_id"));

    if (session.mailbox !== payload.mailbox) {
      throw new ApiError(
        409,
        "session_mailbox_mismatch",
        `Session ${session.session_id} does not belong to ${payload.mailbox}.`
      );
    }

    const cleared_at = now();

    await db
      .update(sessions)
      .set({
        session_status: "cleared",
        active_task_id: null,
        cleared_at,
        updated_at: cleared_at
      })
      .where(eq(sessions.session_id, session.session_id));

    return c.json({
      ok: true,
      session_status: "cleared",
      cleared_at: cleared_at.toISOString()
    });
  });

  app.post("/api/v1/threads", async (c) => {
    const payload = await parseJson(c, createThreadRequestSchema);
    await getMailbox(db, payload.assigned_mailbox);

    const timestamp = now();
    const thread_id = createId("thr");
    const task_id = createId("task");
    const message_id = createId("msg");

    const result = await db.transaction(async (tx) => {
      const [thread] = await tx
        .insert(threads)
        .values({
          thread_id,
          subject: payload.subject,
          created_by_type: "human",
          created_by_id: "human-user",
          assigned_mailbox: payload.assigned_mailbox,
          thread_status: "open",
          created_at: timestamp,
          updated_at: timestamp
        })
        .returning();

      const [task] = await tx
        .insert(tasks)
        .values({
          task_id,
          title: payload.subject,
          thread_id,
          parent_task_id: null,
          created_by_type: "human",
          created_by_id: "human-user",
          assignee_type: "agent",
          assignee_mailbox: payload.assigned_mailbox,
          requires_artifact: false,
          status: "new",
          body: payload.body,
          created_at: timestamp,
          updated_at: timestamp
        })
        .returning();

      const [message] = await tx
        .insert(messages)
        .values({
          message_id,
          thread_id,
          from_type: "human",
          from_id: "human-user",
          to_type: "agent",
          to_id: payload.assigned_mailbox,
          message_kind: "human_mail",
          body: payload.body,
          created_at: timestamp
        })
        .returning();

      return { thread, task, message };
    });

    return c.json(
      {
        thread: serializeThread(result.thread as ThreadRow),
        primary_task: serializeTask(result.task as TaskRow),
        messages: [serializeMessage(result.message as MessageRow)]
      },
      201
    );
  });

  app.get("/api/v1/threads", async (c) => {
    const records = ((await db.select().from(threads).orderBy(desc(threads.updated_at))) ?? []) as ThreadRow[];
    const summaries = await Promise.all(records.map((record) => getThreadSummary(db, record)));

    return c.json(summaries);
  });

  app.get("/api/v1/threads/:thread_id", async (c) => {
    return c.json(await getThreadDetail(db, c.req.param("thread_id")));
  });

  app.post("/api/v1/threads/:thread_id/messages", async (c) => {
    const payload = await parseJson(c, appendMessageRequestSchema);
    const thread = await getThread(db, c.req.param("thread_id"));
    const timestamp = now();

    if (payload.to_type === "agent" && payload.to_id) {
      await getMailbox(db, payload.to_id);
    }

    const [record] = await db.transaction(async (tx) => {
      const [message] = await tx
        .insert(messages)
        .values({
          message_id: createId("msg"),
          thread_id: thread.thread_id,
          from_type: payload.from_type,
          from_id: payload.from_id,
          to_type: payload.to_type ?? null,
          to_id: payload.to_id ?? null,
          message_kind: payload.message_kind,
          body: payload.body,
          created_at: timestamp
        })
        .returning();

      await tx
        .update(threads)
        .set({
          updated_at: timestamp
        })
        .where(eq(threads.thread_id, thread.thread_id));

      return [message];
    });

    return c.json(serializeMessage(record as MessageRow), 201);
  });

  app.get("/api/v1/tasks", async (c) => {
    const query = parseQuery(c, listTasksQuerySchema);
    const conditions = [];

    if (query.assignee_mailbox) {
      conditions.push(eq(tasks.assignee_mailbox, query.assignee_mailbox));
    }

    if (query.status) {
      conditions.push(eq(tasks.status, query.status));
    }

    if (query.thread_id) {
      conditions.push(eq(tasks.thread_id, query.thread_id));
    }

    if (query.parent_task_id) {
      conditions.push(eq(tasks.parent_task_id, query.parent_task_id));
    }

    const selection =
      conditions.length > 0
        ? db.select().from(tasks).where(and(...conditions)).orderBy(desc(tasks.updated_at))
        : db.select().from(tasks).orderBy(desc(tasks.updated_at));

    const records = (await selection) as TaskRow[];

    return c.json(records.map(serializeTask));
  });

  app.post("/api/v1/tasks", async (c) => {
    const payload = await parseJson(c, createTaskRequestSchema);
    await getThread(db, payload.thread_id);
    await assertMailboxExistsForAgentTask(db, payload.assignee_type, payload.assignee_mailbox);

    if (payload.parent_task_id) {
      const parentTask = await getTask(db, payload.parent_task_id);

      if (parentTask.thread_id !== payload.thread_id) {
        throw new ApiError(
          422,
          "parent_thread_mismatch",
          `Child task ${payload.parent_task_id} must share thread ${payload.thread_id}.`
        );
      }
    }

    const timestamp = now();

    const [record] = await db.transaction(async (tx) => {
      const [task] = await tx
        .insert(tasks)
        .values({
          task_id: createId("task"),
          title: payload.title,
          thread_id: payload.thread_id,
          parent_task_id: payload.parent_task_id ?? null,
          created_by_type: payload.created_by_type,
          created_by_id: payload.created_by_id,
          assignee_type: payload.assignee_type,
          assignee_mailbox: payload.assignee_mailbox ?? null,
          requires_artifact: payload.requires_artifact,
          status: payload.status,
          body: payload.body ?? null,
          created_at: timestamp,
          updated_at: timestamp
        })
        .returning();

      await tx
        .update(threads)
        .set({
          updated_at: timestamp
        })
        .where(eq(threads.thread_id, payload.thread_id));

      return [task];
    });

    return c.json(serializeTask(record as TaskRow), 201);
  });

  app.patch("/api/v1/tasks/:task_id/status", async (c) => {
    const payload = await parseJson(c, updateTaskStatusRequestSchema);
    const task = await getTask(db, c.req.param("task_id"));
    await maybeAssertTaskArtifactCompletion(db, task, payload.status);
    const updated_at = now();

    const [record] = await db
      .update(tasks)
      .set({
        status: payload.status,
        updated_at
      })
      .where(eq(tasks.task_id, task.task_id))
      .returning();

    return c.json(serializeTask(record as TaskRow));
  });

  app.post("/api/v1/artifacts", async (c) => {
    const payload = await parseJson(c, createArtifactRequestSchema);
    const task = await getTask(db, payload.task_id);
    await getMailbox(db, payload.mailbox);
    const created_at = now();

    const [record] = await db.transaction(async (tx) => {
      const [artifact] = await tx
        .insert(artifacts)
        .values({
          artifact_id: createId("art"),
          task_id: payload.task_id,
          mailbox: payload.mailbox,
          artifact_type: payload.artifact_type,
          path: payload.path,
          branch: payload.branch ?? null,
          commit_sha: payload.commit_sha ?? null,
          created_at
        })
        .returning();

      await tx
        .update(tasks)
        .set({
          updated_at: created_at
        })
        .where(eq(tasks.task_id, task.task_id));

      return [artifact];
    });

    return c.json(serializeArtifact(record as ArtifactRow), 201);
  });

  app.get("/api/v1/mailboxes/:mailbox/tasks", async (c) => {
    await getMailbox(db, c.req.param("mailbox"));
    const records = ((await db
      .select()
      .from(tasks)
      .where(eq(tasks.assignee_mailbox, c.req.param("mailbox")))
      .orderBy(desc(tasks.updated_at))) ?? []) as TaskRow[];

    return c.json(records.map(serializeTask));
  });

  app.get("/api/v1/tasks/:task_id/work-package", async (c) => {
    const task = await getTask(db, c.req.param("task_id"));
    const thread = await getThread(db, task.thread_id);
    const open_child_tasks = (((await db
      .select()
      .from(tasks)
      .where(eq(tasks.parent_task_id, task.task_id))
      .orderBy(desc(tasks.updated_at))) ?? []) as TaskRow[]).filter((item) => item.status !== "done");
    const recent_artifacts = ((await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.task_id, task.task_id))
      .orderBy(desc(artifacts.created_at))) ?? []) as ArtifactRow[];

    let latest_summary: string | null = null;
    let new_message_rows: MessageRow[] = await getMessageRows(db, thread.thread_id);

    if (task.assignee_mailbox) {
      const activeSession = await getActiveSessionForMailbox(db, task.assignee_mailbox);
      latest_summary = activeSession?.latest_summary ?? null;
      new_message_rows = await getThreadMessagesAfter(
        db,
        thread.thread_id,
        activeSession?.last_processed_message_id ?? undefined
      );
    }

    return c.json(
      workPackageSchema.parse({
        task: serializeTask(task),
        thread: serializeThread(thread),
        latest_summary,
        new_messages: new_message_rows.map(serializeMessage),
        open_child_tasks: open_child_tasks.map(serializeTask),
        recent_artifacts: recent_artifacts.map(serializeArtifact)
      })
    );
  });

  app.get("/api/v1/threads/:thread_id/delta", async (c) => {
    const query = parseQuery(c, threadDeltaQuerySchema);
    await getThread(db, c.req.param("thread_id"));
    const delta = await getThreadMessagesAfter(db, c.req.param("thread_id"), query.after_message_id);

    return c.json({
      thread_id: c.req.param("thread_id"),
      messages: delta.map(serializeMessage)
    });
  });

  return app;
};
