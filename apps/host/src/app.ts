import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  hostHealthResponseSchema,
  hostMcpConfigResponseSchema,
  hostStatusResponseSchema,
  hostWebClearFailureResponseSchema,
  hostWebHostReauthResponseSchema,
  hostWebMailboxDetailResponseSchema,
  hostWebMailboxesQuerySchema,
  hostWebMailboxesResponseSchema,
  hostWebOverviewResponseSchema,
  hostWebRemoveBindingResponseSchema,
  hostWebResumeMailboxResponseSchema,
  hostWebSetManagementStatusResponseSchema
} from "@agent-mail/contracts";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";

import { createMcpServer } from "./mcp.js";
import type { HostRuntime } from "./runtime.js";

const hostWebDistDir = path.resolve("apps/host-web/dist");
const hostRoutePrefixes = ["/api/", "/mcp", "/health", "/status", "/mcp-config"];

export function createHostApp(runtime: HostRuntime) {
  const app = new Hono();

  app.get("/health", (c) => c.json(hostHealthResponseSchema.parse({ ok: true })));

  app.get("/status", async (c) => {
    const payload = await runtime.getStatusPayload();
    return c.json(hostStatusResponseSchema.parse(payload));
  });

  app.get("/mcp-config", (c) => c.json(hostMcpConfigResponseSchema.parse(runtime.getMcpConfigPayload())));

  app.get("/api/v1/web/overview", async (c) => {
    const payload = await runtime.getWebOverviewPayload();
    return c.json(hostWebOverviewResponseSchema.parse(payload));
  });

  app.get("/api/v1/web/mailboxes", async (c) => {
    const query = hostWebMailboxesQuerySchema.parse(c.req.query());
    const payload = await runtime.listWebMailboxesPayload(query);
    return c.json(hostWebMailboxesResponseSchema.parse(payload));
  });

  app.get("/api/v1/web/mailboxes/:mailbox", async (c) => {
    const payload = await runtime.getWebMailboxDetailPayload(c.req.param("mailbox"));
    return c.json(hostWebMailboxDetailResponseSchema.parse(payload));
  });

  app.post("/api/v1/web/host/re-auth", async (c) => {
    const payload = await runtime.reauthenticateHost();
    return c.json(hostWebHostReauthResponseSchema.parse(payload), 200);
  });

  app.post("/api/v1/web/mailboxes/:mailbox/resume", async (c) => {
    const payload = await runtime.resumeMailboxNow(c.req.param("mailbox"));
    return c.json(hostWebResumeMailboxResponseSchema.parse(payload), 200);
  });

  app.post("/api/v1/web/mailboxes/:mailbox/clear-failure", async (c) => {
    const payload = await runtime.clearMailboxFailure(c.req.param("mailbox"));
    return c.json(hostWebClearFailureResponseSchema.parse(payload), 200);
  });

  app.post("/api/v1/web/mailboxes/:mailbox/enable", async (c) => {
    const payload = await runtime.enableMailbox(c.req.param("mailbox"));
    return c.json(hostWebSetManagementStatusResponseSchema.parse(payload), 200);
  });

  app.post("/api/v1/web/mailboxes/:mailbox/disable", async (c) => {
    const payload = await runtime.disableMailbox(c.req.param("mailbox"));
    return c.json(hostWebSetManagementStatusResponseSchema.parse(payload), 200);
  });

  app.delete("/api/v1/web/mailboxes/:mailbox/binding", async (c) => {
    const payload = await runtime.removeLocalBinding(c.req.param("mailbox"));
    return c.json(hostWebRemoveBindingResponseSchema.parse(payload), 200);
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

  app.get("*", async (c) => {
    const requestPath = c.req.path;
    if (hostRoutePrefixes.some((prefix) => requestPath === prefix || requestPath.startsWith(prefix))) {
      return c.notFound();
    }

    const served = await serveHostWeb(requestPath);
    if (served) {
      return new Response(toArrayBuffer(served.body), {
        headers: {
          "content-type": served.contentType
        }
      });
    }

    if (path.extname(requestPath)) {
      return c.notFound();
    }

    const indexFile = await loadFile(path.join(hostWebDistDir, "index.html"));
    if (!indexFile) {
      return c.text("Host Web build not found. Run `pnpm --filter @agent-mail/host-web build`.", 503);
    }

    return new Response(toArrayBuffer(indexFile.body), {
      headers: {
        "content-type": "text/html; charset=utf-8"
      }
    });
  });

  return app;
}

async function serveHostWeb(requestPath: string): Promise<{
  body: Uint8Array;
  contentType: string;
} | null> {
  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
  const absolutePath = path.resolve(hostWebDistDir, `.${normalizedPath}`);
  if (!isSafeStaticPath(absolutePath)) {
    return null;
  }
  return loadFile(absolutePath);
}

async function loadFile(absolutePath: string): Promise<{
  body: Uint8Array;
  contentType: string;
} | null> {
  try {
    const fileStats = await stat(absolutePath);
    if (!fileStats.isFile()) {
      return null;
    }
    const body = await readFile(absolutePath);
    return {
      body,
      contentType: detectContentType(absolutePath)
    };
  } catch {
    return null;
  }
}

function isSafeStaticPath(absolutePath: string): boolean {
  const relativePath = path.relative(hostWebDistDir, absolutePath);
  return relativePath.length > 0 && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function detectContentType(filePath: string): string {
  switch (path.extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".ico":
      return "image/x-icon";
    case ".map":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
