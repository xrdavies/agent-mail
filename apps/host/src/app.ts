import {
  hostHealthResponseSchema,
  hostMcpConfigResponseSchema,
  hostStatusResponseSchema
} from "@agent-mail/contracts";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";

import { createMcpServer } from "./mcp.js";
import type { HostRuntime } from "./runtime.js";

export function createHostApp(runtime: HostRuntime) {
  const app = new Hono();

  app.get("/health", (c) => c.json(hostHealthResponseSchema.parse({ ok: true })));

  app.get("/status", async (c) => {
    const payload = await runtime.getStatusPayload();
    return c.json(hostStatusResponseSchema.parse(payload));
  });

  app.get("/mcp-config", (c) => {
    const url = runtime.getMcpUrl();
    const payload = {
      command: `codex mcp add agent-mail-host --url ${url}`,
      json: {
        mcpServers: {
          "agent-mail-host": {
            url
          }
        }
      },
      toml: `[mcp_servers.agent-mail-host]\nurl = "${url}"\n`
    };
    return c.json(hostMcpConfigResponseSchema.parse(payload));
  });

  app.all("/mcp", async (c) => {
    if (!runtime.isAuthenticated()) {
      return c.json(
        {
          error: {
            message: "Host is not authenticated with Central"
          }
        },
        503
      );
    }

    const transport = new WebStandardStreamableHTTPServerTransport();
    const server = createMcpServer(runtime);
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return app;
}
