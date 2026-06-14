import {
  agentsListQuerySchema,
  createTaskRequestSchema,
  deliveriesListQuerySchema,
  healthResponseSchema,
  hostAuthExchangeRequestSchema,
  hostHeartbeatRequestSchema,
  hostRegisterRequestSchema,
  issueIdempotencyKeyRequestSchema,
  listTasksQuerySchema,
  markDeliveryReadRequestSchema,
  registerAgentRequestSchema,
  sendEmailRequestSchema,
  unreadDeliveriesQuerySchema,
  updateTaskStatusRequestSchema
} from "@agent-mail/contracts";
import { z } from "zod";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";

import type { CentralConfig } from "./config.js";
import { createDatabase, createPool } from "./db/client.js";
import { HttpError, isHttpError } from "./lib/errors.js";
import { CentralService, type AuthenticatedHost } from "./service.js";

type AppVariables = {
  auth: AuthenticatedHost;
  requestId: string;
};

function jsonError(status: number, message: string, details?: unknown): Response {
  return Response.json(
    {
      error: {
        message,
        ...(details === undefined ? {} : { details })
      }
    },
    { status }
  );
}

function logRequest(input: {
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  authHostId?: string;
  debug?: boolean;
}): void {
  console.log(
    JSON.stringify({
      event: "http_request",
      request_id: input.requestId,
      method: input.method,
      path: input.path,
      status: input.status,
      duration_ms: input.durationMs,
      ...(input.authHostId ? { auth_host_id: input.authHostId } : {}),
      ...(input.debug ? { debug: true } : {})
    })
  );
}

async function parseJson<T>(
  c: Context<{ Variables: AppVariables }>,
  schema: z.ZodType<T>
): Promise<T> {
  const json = await c.req.json();
  return schema.parseAsync(json);
}

function parseQuery<T>(c: Context<{ Variables: AppVariables }>, schema: z.ZodType<T>): T {
  return schema.parse(c.req.query());
}

export function createApp(config: CentralConfig) {
  const pool = createPool(config.databaseUrl);
  const db = createDatabase(pool);
  const service = new CentralService(db, new Set(config.bootstrapKeys));

  const app = new Hono<{ Variables: AppVariables }>();

  app.use("*", async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
    const startedAt = Date.now();
    const debug = c.req.header("x-agent-mail-debug") === "true";
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    await next();
    logRequest({
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - startedAt,
      authHostId: c.get("auth")?.hostId,
      debug
    });
  });

  app.use("*", async (c, next) => {
    try {
      await next();
    } catch (error) {
      if (isHttpError(error)) {
        return jsonError(error.status, error.message, error.details);
      }
      if (error instanceof HTTPException) {
        return jsonError(error.status, error.message);
      }
      console.error(error);
      return jsonError(500, "Internal server error");
    }
  });

  app.get("/api/v1/health", async (c) => c.json(healthResponseSchema.parse({ ok: true })));

  app.use("/api/v1/*", async (c, next) => {
    if (c.req.path === "/api/v1/health" || c.req.path === "/api/v1/host-auth/exchange") {
      return next();
    }

    const authorization = c.req.header("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      throw new HttpError(401, "Missing bearer token");
    }

    const token = authorization.slice("Bearer ".length).trim();
    const auth = await service.authenticate(token);
    c.set("auth", auth);
    await next();
  });

  app.post("/api/v1/host-auth/exchange", async (c) => {
    const request = await parseJson(c, hostAuthExchangeRequestSchema);
    const response = await service.exchangeHostToken(request);
    return c.json(response, 200);
  });

  app.post("/api/v1/hosts/register", async (c) => {
    const request = await parseJson(c, hostRegisterRequestSchema);
    const response = await service.registerHost(c.get("auth"), request);
    return c.json(response, 200);
  });

  app.post("/api/v1/hosts/:host_id/heartbeat", async (c) => {
    const request = await parseJson(c, hostHeartbeatRequestSchema);
    const response = await service.heartbeat(c.get("auth"), c.req.param("host_id"), request);
    return c.json(response, 200);
  });

  app.post("/api/v1/idempotency-keys/issue", async (c) => {
    const request = await parseJson(c, issueIdempotencyKeyRequestSchema);
    const action = request.action === "create_task" ? "create_task" : "send_email";
    const response = await service.issueIdempotencyKey(
      c.get("auth"),
      request.mailbox,
      action
    );
    return c.json(response, 200);
  });

  app.post("/api/v1/agents/register", async (c) => {
    const request = await parseJson(c, registerAgentRequestSchema);
    const response = await service.registerAgent(c.get("auth"), request);
    return c.json(response, 200);
  });

  app.get("/api/v1/agents", async (c) => {
    const query = parseQuery(c, agentsListQuerySchema);
    const response = await service.listAgents(query.include_retired ?? false);
    return c.json(response, 200);
  });

  app.get("/api/v1/agents/:mailbox", async (c) => {
    const response = await service.getAgentByMailbox(c.req.param("mailbox"));
    return c.json(response, 200);
  });

  app.post("/api/v1/emails/send", async (c) => {
    const request = await parseJson(c, sendEmailRequestSchema);
    const response = await service.sendEmail(c.get("auth"), {
      ...request,
      cc: request.cc ?? [],
      references: request.references ?? [],
      linked_resources: request.linked_resources ?? []
    });
    return c.json(response, 201);
  });

  app.get("/api/v1/mailboxes/:mailbox/deliveries", async (c) => {
    const query = parseQuery(c, deliveriesListQuerySchema);
    const response = await service.listDeliveries(c.req.param("mailbox"), {
      ...(query.read_status ? { readStatus: query.read_status } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
      ...(query.order ? { order: query.order } : {})
    });
    return c.json(response, 200);
  });

  app.get("/api/v1/mailboxes/:mailbox/unread-deliveries", async (c) => {
    const query = parseQuery(c, unreadDeliveriesQuerySchema);
    const response = await service.listDeliveries(c.req.param("mailbox"), {
      readStatus: "unread",
      ...(query.limit ? { limit: query.limit } : {}),
      ...(query.order ? { order: query.order } : {})
    });
    return c.json(response, 200);
  });

  app.get("/api/v1/mailboxes/:mailbox/unread-deliveries/oldest", async (c) => {
    const response = await service.getOldestUnreadDelivery(c.req.param("mailbox"));
    return c.json(response, 200);
  });

  app.post("/api/v1/deliveries/:delivery_id/read", async (c) => {
    const request = await parseJson(c, markDeliveryReadRequestSchema);
    const response = await service.markDeliveryRead(request.mailbox, c.req.param("delivery_id"));
    return c.json(response, 200);
  });

  app.get("/api/v1/emails/:email_id", async (c) => {
    const response = await service.getEmail(c.req.param("email_id"));
    return c.json(response, 200);
  });

  app.get("/api/v1/threads/:thread_id", async (c) => {
    const response = await service.getThread(c.req.param("thread_id"));
    return c.json(response, 200);
  });

  app.post("/api/v1/tasks", async (c) => {
    const request = await parseJson(c, createTaskRequestSchema);
    const response = await service.createTask(c.get("auth"), request);
    return c.json(response, 201);
  });

  app.get("/api/v1/tasks", async (c) => {
    const query = parseQuery(c, listTasksQuerySchema);
    const response = await service.listTasks({
      ...(query.assignee_mailbox ? { assigneeMailbox: query.assignee_mailbox } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.thread_id ? { threadId: query.thread_id } : {}),
      ...(query.trigger_email_id ? { triggerEmailId: query.trigger_email_id } : {}),
      ...(query.parent_task_id ? { parentTaskId: query.parent_task_id } : {})
    });
    return c.json(response, 200);
  });

  app.patch("/api/v1/tasks/:task_id/status", async (c) => {
    const request = await parseJson(c, updateTaskStatusRequestSchema);
    const response = await service.updateTaskStatus(c.req.param("task_id"), request);
    return c.json(response, 200);
  });

  return { app, pool, service };
}

export type CentralApp = ReturnType<typeof createApp>;
