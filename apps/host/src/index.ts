import "dotenv/config";
import { serve } from "@hono/node-server";
import { dirname, resolve } from "node:path";
import { z } from "zod";

import { createHostApp } from "./app.js";
import { CentralApiClient } from "./client.js";
import { loadHostConfig } from "./config.js";
import { HostOrchestrator } from "./orchestrator.js";
import { HostService } from "./service.js";
import { HostStateStore } from "./state.js";

const envSchema = z.object({
  CENTRAL_BASE_URL: z.string().url().default("http://localhost:3000"),
  HOST_CONFIG_PATH: z.string().min(1).default("apps/host/host.example.toml"),
  HOST_STATE_PATH: z.string().min(1).default(".agent-mail/host-state.json"),
  HOST_PORT: z.coerce.number().int().positive().default(8788),
  HOST_BASE_URL: z.string().url().default("http://127.0.0.1:8788"),
  HOST_VERSION: z.string().min(1).default("0.1.0"),
  MACHINE_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(10000),
  SESSION_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(10000),
  PENDING_WORK_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
  CODEX_BIN: z.string().min(1).default("codex")
});

const env = envSchema.parse(process.env);

const main = async () => {
  const config = await loadHostConfig(resolve(env.HOST_CONFIG_PATH));
  const service = new HostService({
    config,
    client: new CentralApiClient(env.CENTRAL_BASE_URL),
    stateStore: new HostStateStore(resolve(env.HOST_STATE_PATH)),
    centralBaseUrl: env.CENTRAL_BASE_URL,
    hostVersion: env.HOST_VERSION,
    machineHeartbeatIntervalMs: env.MACHINE_HEARTBEAT_INTERVAL_MS,
    sessionHeartbeatIntervalMs: env.SESSION_HEARTBEAT_INTERVAL_MS
  });

  await service.start();

  const app = createHostApp(service);
  const server = serve(
    {
      fetch: app.fetch,
      port: env.HOST_PORT
    },
    (info) => {
      console.log(`Agent Host listening on http://localhost:${info.port}`);
    }
  );

  const orchestrator = new HostOrchestrator({
    service,
    intervalMs: env.PENDING_WORK_INTERVAL_MS,
    hostBaseUrl: env.HOST_BASE_URL,
    stateDir: dirname(resolve(env.HOST_STATE_PATH)),
    codexBin: env.CODEX_BIN
  });
  orchestrator.start();

  const shutdown = async () => {
    orchestrator.stop();
    await service.stop();
    server.close();
  };

  process.on("SIGINT", () => {
    void shutdown();
  });

  process.on("SIGTERM", () => {
    void shutdown();
  });
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
