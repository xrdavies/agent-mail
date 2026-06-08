import { PGlite } from "@electric-sql/pglite";
import { type RuntimeContext, type Session, type Task, type WorkPackage } from "@agent-mail/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp as createCentralApp } from "../../central/src/app.js";
import * as centralSchema from "../../central/src/db/schema.js";
import { createHostApp } from "../src/app.js";
import { CentralApiClient } from "../src/client.js";
import { loadHostConfig } from "../src/config.js";
import { createHostMcpServer } from "../src/mcp.js";
import { HostService } from "../src/service.js";
import { HostStateStore } from "../src/state.js";

const migrationsFolder = fileURLToPath(new URL("../../central/drizzle", import.meta.url));

const resources: Array<{
  client?: PGlite;
  tempDir?: string;
  service?: HostService;
}> = [];

const originalCodexHome = process.env.CODEX_HOME;

const createCentralTestContext = async () => {
  const client = new PGlite();
  const db = drizzle(client, { schema: centralSchema });
  await migrate(db, { migrationsFolder });
  const app = createCentralApp(db as never);

  resources.push({ client });

  const centralFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" || input instanceof URL ? new URL(input) : new URL(input.url);
    return app.request(`${url.pathname}${url.search}`, init);
  };

  return { app, centralFetch };
};

const createHostFiles = async (configSource?: string) => {
  const tempDir = await mkdtemp(join(tmpdir(), "agent-mail-host-"));
  const configPath = join(tempDir, "host.toml");
  const statePath = join(tempDir, "host-state.json");

  await writeFile(
    configPath,
    configSource ??
      `machine_id = "mac-b"
label = "Mac B"

[[mailboxes]]
mailbox = "pm.aster@agents.local"
name = "Aster"
role = "pm"
workspace_path = "/Users/me/worktrees/pm-aster"
git_user_name = "Aster"
git_user_email = "pm.aster@agents.local"

[[mailboxes]]
mailbox = "backend.coda@agents.local"
name = "Coda"
role = "backend"
workspace_path = "/Users/me/worktrees/backend-coda"
git_user_name = "Coda"
git_user_email = "backend.coda@agents.local"
`,
    "utf8"
  );

  resources.push({ tempDir });

  return { configPath, statePath, tempDir };
};

const createCodexSessionHome = async (workspacePath: string, sessionId: string) => {
  const codexHome = await mkdtemp(join(tmpdir(), "agent-mail-codex-"));
  const sessionDir = join(codexHome, "sessions", "2026", "06", "09");
  const sessionPath = join(sessionDir, `rollout-2026-06-09T00-00-00-${sessionId}.jsonl`);

  await mkdir(sessionDir, { recursive: true });

  await writeFile(
    sessionPath,
    `${JSON.stringify({
      timestamp: "2026-06-09T00:00:00.000Z",
      type: "session_meta",
      payload: {
        id: sessionId,
        timestamp: "2026-06-09T00:00:00.000Z",
        cwd: workspacePath,
        originator: "codex-tui"
      }
    })}\n`,
    "utf8"
  );

  resources.push({ tempDir: codexHome });
  process.env.CODEX_HOME = codexHome;
};

const createService = async () => {
  const { centralFetch, app: centralApp } = await createCentralTestContext();
  const { configPath, statePath } = await createHostFiles();
  const config = await loadHostConfig(configPath);
  const service = new HostService({
    config,
    client: new CentralApiClient("http://central.test", centralFetch),
    stateStore: new HostStateStore(statePath),
    centralBaseUrl: "http://central.test",
    hostVersion: "0.1.0",
    machineHeartbeatIntervalMs: 60_000,
    sessionHeartbeatIntervalMs: 60_000
  });

  resources.push({ service });
  await service.start();

  return { service, centralApp, statePath };
};

const createMcpClientPair = async (service: HostService) => {
  const server = createHostMcpServer(service);
  const client = new Client({ name: "agent-mail-host-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  clientTransport.sessionId = "test-transport-session";

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, clientTransport, serverTransport };
};

beforeEach(() => {
  process.env.CODEX_HOME = originalCodexHome;
});

afterEach(async () => {
  process.env.CODEX_HOME = originalCodexHome;

  await Promise.all(
    resources.splice(0).map(async ({ client, tempDir, service }) => {
      await service?.stop();
      await client?.close();
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true });
      }
    })
  );
});

describe("Agent Host", () => {
  it("loads TOML config and rejects duplicate mailboxes", async () => {
    const { configPath } = await createHostFiles(
      `machine_id = "mac-b"
label = "Mac B"

[[mailboxes]]
mailbox = "pm.aster@agents.local"
name = "Aster"
role = "pm"
workspace_path = "/Users/me/worktrees/pm-aster"
git_user_name = "Aster"
git_user_email = "pm.aster@agents.local"

[[mailboxes]]
mailbox = "pm.aster@agents.local"
name = "Aster Again"
role = "pm"
workspace_path = "/Users/me/worktrees/pm-aster-2"
git_user_name = "Aster"
git_user_email = "pm.aster@agents.local"
`
    );

    await expect(loadHostConfig(configPath)).rejects.toThrow(/Duplicate mailbox/);
  });

  it("registers machine and mailboxes on startup and exposes status", async () => {
    const { service, centralApp, statePath } = await createService();

    const statusApp = createHostApp(service);
    const statusResponse = await statusApp.request("/status");
    expect(statusResponse.status).toBe(200);

    const status = (await statusResponse.json()) as {
      machine_id: string;
      host_status: string;
      mailboxes: Array<{ mailbox: string }>;
    };
    expect(status.machine_id).toBe("mac-b");
    expect(status.host_status).toBe("online");
    expect(status.mailboxes).toHaveLength(2);

    const machinesResponse = await centralApp.request("/api/v1/machines");
    const machines = (await machinesResponse.json()) as Array<{ machine_id: string }>;
    expect(machines).toHaveLength(1);
    expect(machines[0].machine_id).toBe("mac-b");

    const mailboxesResponse = await centralApp.request("/api/v1/mailboxes");
    const mailboxes = (await mailboxesResponse.json()) as Array<{ mailbox: string }>;
    expect(mailboxes).toHaveLength(2);

    const persistedState = JSON.parse(await readFile(statePath, "utf8")) as {
      machine_id: string;
      mailboxes: Record<string, unknown>;
    };
    expect(persistedState.machine_id).toBe("mac-b");
    expect(Object.keys(persistedState.mailboxes)).toContain("pm.aster@agents.local");
  });

  it("bootstraps a mailbox through MCP and persists the real Codex session id", async () => {
    await createCodexSessionHome("/Users/me/worktrees/pm-aster", "codex-session-pm-001");
    const { service, centralApp } = await createService();
    const { client, clientTransport } = await createMcpClientPair(service);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "bootstrap_session",
        "get_runtime_context",
        "list_mailbox_tasks",
        "get_task_work_package",
        "get_thread_delta",
        "get_full_thread",
        "reply_thread",
        "create_child_task",
        "update_task_status",
        "list_agents"
      ])
    );

    const bootstrapResult = await client.callTool({
      name: "bootstrap_session",
      arguments: {
        mailbox: "pm.aster@agents.local",
        role: "pm",
        name: "Aster",
        workspacePath: "/Users/me/worktrees/pm-aster"
      }
    });

    expect(bootstrapResult.isError).toBeFalsy();
    const runtimeContext = (bootstrapResult.structuredContent as {
      runtimeContext: RuntimeContext;
    }).runtimeContext;
    expect(runtimeContext.session_id).toBe("codex-session-pm-001");
    expect(runtimeContext.session_status).toBe("idle");
    expect(clientTransport.sessionId).toBe("test-transport-session");

    const sessionResponse = await centralApp.request("/api/v1/sessions/codex-session-pm-001");
    expect(sessionResponse.status).toBe(200);
    const session = (await sessionResponse.json()) as Session;
    expect(session.session_status).toBe("idle");

    const contextResult = await client.callTool({
      name: "get_runtime_context",
      arguments: { mailbox: "pm.aster@agents.local" }
    });

    expect(
      (contextResult.structuredContent as { runtimeContext: RuntimeContext }).runtimeContext.session_id
    ).toBe(
      "codex-session-pm-001"
    );
  });

  it("serves runtime task and thread tools through MCP", async () => {
    await createCodexSessionHome("/Users/me/worktrees/pm-aster", "codex-session-pm-001");
    const { service, centralApp } = await createService();
    const { client } = await createMcpClientPair(service);

    await client.callTool({
      name: "bootstrap_session",
      arguments: {
        mailbox: "pm.aster@agents.local",
        role: "pm",
        name: "Aster",
        workspacePath: "/Users/me/worktrees/pm-aster"
      }
    });

    const createThreadResponse = await centralApp.request("/api/v1/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject: "Review implementation plan",
        body: "Please review the implementation plan and coordinate backend follow-up.",
        assigned_mailbox: "pm.aster@agents.local"
      })
    });
    const createdThread = (await createThreadResponse.json()) as {
      thread: { thread_id: string };
      primary_task: { task_id: string };
      messages: Array<{ message_id: string }>;
    };

    const threadId = createdThread.thread.thread_id;
    const primaryTaskId = createdThread.primary_task.task_id;
    const firstMessageId = createdThread.messages[0].message_id;

    const tasksResult = await client.callTool({
      name: "list_mailbox_tasks",
      arguments: { mailbox: "pm.aster@agents.local" }
    });
    const tasks = (tasksResult.structuredContent as { tasks: Task[] }).tasks;
    expect(tasks.some((task) => task.task_id === primaryTaskId)).toBe(true);

    const workPackageResult = await client.callTool({
      name: "get_task_work_package",
      arguments: { mailbox: "pm.aster@agents.local", taskId: primaryTaskId }
    });
    const workPackage = (workPackageResult.structuredContent as {
      workPackage: WorkPackage;
    }).workPackage;
    expect(workPackage.task.task_id).toBe(primaryTaskId);
    expect(workPackage.new_messages).toHaveLength(1);

    const replyResult = await client.callTool({
      name: "reply_thread",
      arguments: {
        mailbox: "pm.aster@agents.local",
        threadId,
        body: "Backend also needs to review the interface constraints.",
        toMailbox: "human-user"
      }
    });
    expect(replyResult.isError).toBeFalsy();

    const deltaResult = await client.callTool({
      name: "get_thread_delta",
      arguments: {
        mailbox: "pm.aster@agents.local",
        threadId,
        afterMessageId: firstMessageId
      }
    });
    const delta = (deltaResult.structuredContent as {
      delta: {
        thread_id: string;
        messages: Array<{ body: string }>;
      };
    }).delta;
    expect(delta.messages).toHaveLength(1);

    const childTaskResult = await client.callTool({
      name: "create_child_task",
      arguments: {
        mailbox: "pm.aster@agents.local",
        threadId,
        title: "Review backend constraints",
        toMailbox: "backend.coda@agents.local",
        body: "Please summarize backend interface constraints.",
        requiresArtifact: false
      }
    });
    const childTask = (childTaskResult.structuredContent as { task: Task }).task;
    expect(childTask.assignee_mailbox).toBe("backend.coda@agents.local");

    const statusResult = await client.callTool({
      name: "update_task_status",
      arguments: {
        mailbox: "backend.coda@agents.local",
        taskId: childTask.task_id,
        status: "done"
      }
    });
    expect((statusResult.structuredContent as { task: Task }).task.status).toBe("done");

    const fullThreadResult = await client.callTool({
      name: "get_full_thread",
      arguments: { mailbox: "pm.aster@agents.local", threadId }
    });
    const fullThread = (fullThreadResult.structuredContent as {
      thread: {
        messages: unknown[];
        related_tasks: Task[];
      };
    }).thread;
    expect(fullThread.messages).toHaveLength(2);
    expect(fullThread.related_tasks).toHaveLength(2);

    const agentsResult = await client.callTool({
      name: "list_agents",
      arguments: { mailbox: "pm.aster@agents.local" }
    });
    const agents = (agentsResult.structuredContent as {
      agents: Array<{ mailbox: string }>;
    }).agents;
    expect(agents.map((agent) => agent.mailbox)).toEqual(
      expect.arrayContaining(["pm.aster@agents.local", "backend.coda@agents.local"])
    );
  });
});
