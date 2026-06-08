import { PGlite } from "@electric-sql/pglite";
import type { Session, ThreadDetail, WorkPackage } from "@agent-mail/shared";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import * as schema from "../src/db/schema.js";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

const setups: Array<{ client: PGlite }> = [];

const createTestContext = async () => {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  const app = createApp(db as never);

  setups.push({ client });

  return { app };
};

afterEach(async () => {
  await Promise.all(setups.splice(0).map(({ client }) => client.close()));
});

const registerMachine = (app: ReturnType<typeof createApp>) =>
  app.request("/api/v1/machines/register", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      machine_id: "mac-b",
      label: "Mac B",
      host_version: "0.1.0"
    })
  });

const registerMailbox = (
  app: ReturnType<typeof createApp>,
  mailbox: string,
  role = "pm",
  name = "Aster"
) =>
  app.request("/api/v1/mailboxes/register", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      mailbox,
      name,
      role,
      machine_id: "mac-b",
      workspace_path: `/Users/me/worktrees/${mailbox.split("@")[0]}`,
      git_user_name: name,
      git_user_email: mailbox
    })
  });

describe("Agent Mail Central API", () => {
  it("registers machines and mailboxes, binds sessions, and clears them", async () => {
    const { app } = await createTestContext();

    const machineResponse = await registerMachine(app);
    expect(machineResponse.status).toBe(200);

    const mailboxResponse = await registerMailbox(app, "pm.aster@agents.local");
    expect(mailboxResponse.status).toBe(200);

    const bindResponse = await app.request("/api/v1/sessions/bind", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        session_id: "sess_pm_001",
        mailbox: "pm.aster@agents.local",
        machine_id: "mac-b",
        workspace_path: "/Users/me/worktrees/pm.aster",
        session_status: "bootstrapping"
      })
    });

    expect(bindResponse.status).toBe(200);

    const session = (await bindResponse.json()) as Session;
    expect(session.session_id).toBe("sess_pm_001");
    expect(session.session_status).toBe("bootstrapping");

    const heartbeatResponse = await app.request("/api/v1/sessions/sess_pm_001/heartbeat", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        mailbox: "pm.aster@agents.local",
        session_status: "idle",
        latest_summary: "Waiting for a new thread."
      })
    });

    expect(heartbeatResponse.status).toBe(200);

    const clearResponse = await app.request("/api/v1/sessions/sess_pm_001/clear", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        mailbox: "pm.aster@agents.local",
        requested_by: "human-user",
        force: false
      })
    });

    expect(clearResponse.status).toBe(200);

    const cleared = (await clearResponse.json()) as { session_status: string };
    expect(cleared.session_status).toBe("cleared");

    const fetchResponse = await app.request("/api/v1/sessions/sess_pm_001");
    const fetched = (await fetchResponse.json()) as Session;
    expect(fetched.session_status).toBe("cleared");
    expect(fetched.latest_summary).toBe("Waiting for a new thread.");
  });

  it("rejects binding a second active session for the same mailbox", async () => {
    const { app } = await createTestContext();

    await registerMachine(app);
    await registerMailbox(app, "pm.aster@agents.local");

    await app.request("/api/v1/sessions/bind", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        session_id: "sess_pm_001",
        mailbox: "pm.aster@agents.local",
        machine_id: "mac-b",
        workspace_path: "/Users/me/worktrees/pm.aster",
        session_status: "idle"
      })
    });

    const conflictResponse = await app.request("/api/v1/sessions/bind", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        session_id: "sess_pm_002",
        mailbox: "pm.aster@agents.local",
        machine_id: "mac-b",
        workspace_path: "/Users/me/worktrees/pm.aster",
        session_status: "bootstrapping"
      })
    });

    expect(conflictResponse.status).toBe(409);
    await expect(conflictResponse.json()).resolves.toMatchObject({
      error: {
        code: "active_session_conflict"
      }
    });
  });

  it("builds thread detail, delta, and work-package payloads", async () => {
    const { app } = await createTestContext();

    await registerMachine(app);
    await registerMailbox(app, "pm.aster@agents.local");
    await registerMailbox(app, "backend.coda@agents.local", "backend", "Coda");

    await app.request("/api/v1/sessions/bind", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        session_id: "sess_pm_001",
        mailbox: "pm.aster@agents.local",
        machine_id: "mac-b",
        workspace_path: "/Users/me/worktrees/pm.aster",
        session_status: "idle"
      })
    });

    const createThreadResponse = await app.request("/api/v1/threads", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        subject: "Review implementation plan",
        body: "Please review the implementation plan and break out follow-up work.",
        assigned_mailbox: "pm.aster@agents.local"
      })
    });

    expect(createThreadResponse.status).toBe(201);
    const createdThread = (await createThreadResponse.json()) as {
      thread: { thread_id: string };
      primary_task: { task_id: string };
      messages: Array<{ message_id: string }>;
    };

    const threadId = createdThread.thread.thread_id as string;
    const primaryTaskId = createdThread.primary_task.task_id as string;
    const initialMessageId = createdThread.messages[0].message_id as string;

    const sessionHeartbeatResponse = await app.request("/api/v1/sessions/sess_pm_001/heartbeat", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        mailbox: "pm.aster@agents.local",
        session_status: "running",
        active_task_id: primaryTaskId,
        last_processed_message_id: initialMessageId,
        latest_summary: "Primary review has started."
      })
    });

    expect(sessionHeartbeatResponse.status).toBe(200);

    const appendMessageResponse = await app.request(`/api/v1/threads/${threadId}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from_type: "human",
        from_id: "human-user",
        to_type: "agent",
        to_id: "pm.aster@agents.local",
        message_kind: "human_mail",
        body: "Backend should also review interface constraints."
      })
    });

    expect(appendMessageResponse.status).toBe(201);

    const childTaskResponse = await app.request("/api/v1/tasks", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        title: "Review backend constraints",
        thread_id: threadId,
        parent_task_id: primaryTaskId,
        created_by_type: "agent",
        created_by_id: "pm.aster@agents.local",
        assignee_type: "agent",
        assignee_mailbox: "backend.coda@agents.local",
        requires_artifact: false,
        status: "new",
        body: "Please summarize backend constraints and interface risks."
      })
    });

    expect(childTaskResponse.status).toBe(201);

    const deltaResponse = await app.request(
      `/api/v1/threads/${threadId}/delta?after_message_id=${initialMessageId}`
    );

    expect(deltaResponse.status).toBe(200);
    const delta = (await deltaResponse.json()) as { messages: Array<{ body: string }> };
    expect(delta.messages).toHaveLength(1);
    expect(delta.messages[0].body).toContain("Backend should also review");

    const workPackageResponse = await app.request(`/api/v1/tasks/${primaryTaskId}/work-package`);

    expect(workPackageResponse.status).toBe(200);
    const workPackage = (await workPackageResponse.json()) as WorkPackage;
    expect(workPackage.latest_summary).toBe("Primary review has started.");
    expect(workPackage.new_messages).toHaveLength(1);
    expect(workPackage.open_child_tasks).toHaveLength(1);
    expect(workPackage.open_child_tasks[0].assignee_mailbox).toBe("backend.coda@agents.local");

    const detailResponse = await app.request(`/api/v1/threads/${threadId}`);
    const detail = (await detailResponse.json()) as ThreadDetail;
    expect(detail.messages).toHaveLength(2);
    expect(detail.related_tasks).toHaveLength(2);
  });

  it("requires artifacts before a requires_artifact task can be completed", async () => {
    const { app } = await createTestContext();

    await registerMachine(app);
    await registerMailbox(app, "backend.coda@agents.local", "backend", "Coda");

    const createThreadResponse = await app.request("/api/v1/threads", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        subject: "Produce a runbook",
        body: "Please produce an operational runbook.",
        assigned_mailbox: "backend.coda@agents.local"
      })
    });

    const createdThread = (await createThreadResponse.json()) as {
      thread: { thread_id: string };
      primary_task: { task_id: string };
    };

    const taskResponse = await app.request("/api/v1/tasks", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        title: "Write runbook",
        thread_id: createdThread.thread.thread_id,
        parent_task_id: createdThread.primary_task.task_id,
        created_by_type: "agent",
        created_by_id: "backend.coda@agents.local",
        assignee_type: "agent",
        assignee_mailbox: "backend.coda@agents.local",
        requires_artifact: true,
        status: "in_progress",
        body: "Create RUNBOOK.md for deployment and rollback."
      })
    });

    expect(taskResponse.status).toBe(201);
    const task = (await taskResponse.json()) as { task_id: string };

    const prematureDoneResponse = await app.request(`/api/v1/tasks/${task.task_id}/status`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        status: "done"
      })
    });

    expect(prematureDoneResponse.status).toBe(422);

    const artifactResponse = await app.request("/api/v1/artifacts", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        task_id: task.task_id,
        mailbox: "backend.coda@agents.local",
        artifact_type: "document",
        path: "RUNBOOK.md",
        branch: "agent-mail/backend.coda/task_runbook",
        commit_sha: "abc123"
      })
    });

    expect(artifactResponse.status).toBe(201);

    const finalDoneResponse = await app.request(`/api/v1/tasks/${task.task_id}/status`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        status: "done"
      })
    });

    expect(finalDoneResponse.status).toBe(200);
    await expect(finalDoneResponse.json()).resolves.toMatchObject({
      status: "done"
    });
  });
});
