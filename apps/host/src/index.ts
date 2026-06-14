import { serve } from "@hono/node-server";

import { createHostApp } from "./app.js";
import { loadHostConfig } from "./config.js";
import { HostRuntime } from "./runtime.js";
import { HostStateStore } from "./state.js";

const config = loadHostConfig();
const state = new HostStateStore(config.statePath, config.managedMailboxes);
const runtime = new HostRuntime(config, state);
const app = createHostApp(runtime);

async function main(): Promise<void> {
  await runtime.start();
  serve(
    {
      fetch: app.fetch,
      port: config.port,
      hostname: config.host
    },
    (info) => {
      console.log(`Agent Mail Host listening on http://${info.address}:${info.port}`);
      console.log(`MCP config available at http://${info.address}:${info.port}/mcp-config`);
    }
  );
}

void main().catch(async (error) => {
  console.error(error);
  await runtime.stop();
  process.exitCode = 1;
});
