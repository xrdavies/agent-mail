import { PGlite } from "@electric-sql/pglite";
import type { Session } from "@agent-mail/shared";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { createApp as createCentralApp } from "../../central/src/app.js";
import * as centralSchema from "../../central/src/db/schema.js";
import { createHostApp } from "../src/app.js";
import { CentralApiClient } from "../src/client.js";
import { loadHostConfig } from "../src/config.js";
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

  return { configPath, statePath };
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

  it("persists session bindings and forwards session heartbeats to central", async () => {
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
    await service.bindSession({
      mailbox: "pm.aster@agents.local",
      session_id: "sess_pm_001",
      session_status: "idle"
    });
    await service.updateSession("pm.aster@agents.local", {
      latest_summary: "Waiting for backend follow-up."
    });
    await service.sendSessionHeartbeats();

    const sessionResponse = await centralApp.request("/api/v1/sessions/sess_pm_001");
    expect(sessionResponse.status).toBe(200);
    const session = (await sessionResponse.json()) as Session;
    expect(session.session_status).toBe("idle");
    expect(session.latest_summary).toBe("Waiting for backend follow-up.");

    const snapshot = service.getStatusSnapshot();
    expect(snapshot.mailboxes[0].current_session?.session_id).toBe("sess_pm_001");

    const restartedService = new HostService({
      config,
      client: new CentralApiClient("http://central.test", centralFetch),
      stateStore: new HostStateStore(statePath),
      centralBaseUrl: "http://central.test",
      hostVersion: "0.1.0",
      machineHeartbeatIntervalMs: 60_000,
      sessionHeartbeatIntervalMs: 60_000
    });

    resources.push({ service: restartedService });

    await restartedService.start();

    expect(restartedService.getStatusSnapshot().mailboxes[0].current_session?.session_id).toBe(
      "sess_pm_001"
    );
  });
});
