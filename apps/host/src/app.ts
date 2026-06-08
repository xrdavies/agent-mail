import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import type { HostService } from "./service.js";
import { createHostMcpServer } from "./mcp.js";

export const createHostApp = (service: HostService) => {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({
      ok: true,
      host_status: service.getStatusSnapshot().host_status
    })
  );

  app.get("/status", (c) => c.json(service.getStatusSnapshot()));

  app.all("/mcp", async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport();
    const server = createHostMcpServer(service);
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return app;
};
