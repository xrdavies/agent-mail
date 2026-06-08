import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { createApp as createCentralApp } from "../../central/src/app.js";
import * as centralSchema from "../../central/src/db/schema.js";
import { CentralApiClient } from "../src/client.js";
import { CodexRunner } from "../src/codex-runner.js";
import { loadHostConfig } from "../src/config.js";
import { HostOrchestrator } from "../src/orchestrator.js";
import { HostService } from "../src/service.js";
import { HostStateStore } from "../src/state.js";

const migrationsFolder = fileURLToPath(new URL("../../central/drizzle", import.meta.url));

const resources: Array<{
  client?: PGlite;
  tempDir?: string;
  service?: HostService;
}> = [];

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

const createHostFiles = async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "agent-mail-orchestrator-"));
  const configPath = join(tempDir, "host.toml");
  const statePath = join(tempDir, "host-state.json");

  await writeFile(
    configPath,
    `machine_id = "mac-b"
label = "Mac B"

[[mailboxes]]
mailbox = "pm.aster@agents.local"
name = "Aster"
role = "pm"
workspace_path = "/Users/me/worktrees/pm-aster"
git_user_name = "Aster"
git_user_email = "pm.aster@agents.local"
`,
    "utf8"
  );

  resources.push({ tempDir });

  return { configPath, statePath, tempDir };
};

const createService = async () => {
  const { app, centralFetch } = await createCentralTestContext();
  const { configPath, statePath, tempDir } = await createHostFiles();
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

  resources.push({ service, tempDir });
  await service.start();

  return { app, service, statePath, tempDir };
};

afterEach(async () => {
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

describe("CodexRunner", () => {
  it("builds exec and resume commands and parses thread ids", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "agent-mail-runner-"));
    resources.push({ tempDir });

    const calls: Array<{
      cmd: string;
      args: string[];
      cwd: string;
      stdin: string;
      env?: NodeJS.ProcessEnv;
    }> = [];
    const runner = new CodexRunner(async ({ cmd, args, cwd, stdin, env }) => {
      calls.push({ cmd, args, cwd, stdin, env });
      const outputPath = args[args.indexOf("-o") + 1];
      await writeFile(outputPath, "OK\n", "utf8");

      return {
        exitCode: 0,
        stdout: `${JSON.stringify({ type: "thread.started", thread_id: "session-123" })}\n`,
        stderr: ""
      };
    }, "codex-test");

    const execResult = await runner.runTurn({
      workspacePath: "/Users/me/worktrees/pm-aster",
      prompt: "bootstrap prompt",
      outputFile: join(tempDir, "exec.txt"),
      mcpUrl: "http://127.0.0.1:8788/mcp",
      gitUserName: "Aster",
      gitUserEmail: "pm.aster@agents.local"
    });

    expect(execResult.sessionId).toBe("session-123");
    expect(execResult.lastMessage).toBe("OK");
    expect(calls[0].cmd).toBe("codex-test");
    expect(calls[0].args).toContain("exec");
    expect(calls[0].args).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(calls[0].args).toContain(`mcp_servers.agent_mail_host.url="http://127.0.0.1:8788/mcp"`);
    expect(calls[0].env?.GIT_AUTHOR_NAME).toBe("Aster");
    expect(calls[0].env?.GIT_AUTHOR_EMAIL).toBe("pm.aster@agents.local");

    await runner.runTurn({
      workspacePath: "/Users/me/worktrees/pm-aster",
      prompt: "resume prompt",
      outputFile: join(tempDir, "resume.txt"),
      mcpUrl: "http://127.0.0.1:8788/mcp",
      sessionId: "session-123"
    });

    expect(calls[1].args).toContain("resume");
    expect(calls[1].args).toContain("session-123");
  });
});

describe("HostOrchestrator", () => {
  it("chooses exec first and resume later for the same mailbox session", async () => {
    const { app, service, tempDir } = await createService();

    const createThreadResponse = await app.request("/api/v1/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject: "Review implementation plan",
        body: "Please review the plan and continue work.",
        assigned_mailbox: "pm.aster@agents.local"
      })
    });
    const threadPayload = (await createThreadResponse.json()) as {
      primary_task: { task_id: string };
    };

    const runnerCalls: Array<{ sessionId?: string | null; prompt: string }> = [];
    const fakeRunner = {
      async runTurn(input: {
        sessionId?: string | null;
        prompt: string;
      }) {
        runnerCalls.push({
          sessionId: input.sessionId ?? null,
          prompt: input.prompt
        });

        return {
          sessionId: "session-001",
          lastMessage: runnerCalls.length === 1 ? "First summary" : "Second summary",
          stdout: "",
          stderr: ""
        };
      }
    };

    const orchestrator = new HostOrchestrator({
      service,
      intervalMs: 60_000,
      codexRunner: fakeRunner,
      hostBaseUrl: "http://127.0.0.1:8788",
      stateDir: tempDir
    });

    await orchestrator.processPendingWorkOnce();

    expect(runnerCalls).toHaveLength(1);
    expect(runnerCalls[0].sessionId).toBeNull();
    expect(runnerCalls[0].prompt).toContain("bootstrap your Agent Mail runtime identity");
    expect(service.getCurrentSession("pm.aster@agents.local")?.session_id).toBe("session-001");
    expect(service.getRuntimeContext("pm.aster@agents.local").latest_summary).toBe("First summary");

    await orchestrator.processPendingWorkOnce();

    expect(runnerCalls).toHaveLength(2);
    expect(runnerCalls[1].sessionId).toBe("session-001");
    expect(runnerCalls[1].prompt).toContain("This is a resumed mailbox session");
    expect(service.getRuntimeContext("pm.aster@agents.local").latest_summary).toBe("Second summary");
    expect(threadPayload.primary_task.task_id).toBe(
      service.getCurrentSession("pm.aster@agents.local")?.active_task_id
    );
  });
});
