import { describe, expect, it } from "vitest";

import type { CentralConfig } from "../src/config.js";
import { createApp } from "../src/app.js";
import { CentralLogger } from "../src/lib/logger.js";
import type { CentralService } from "../src/service.js";

const testConfig: CentralConfig = {
  port: 3000,
  host: "127.0.0.1",
  databaseUrl: "postgres://ignored",
  bootstrapKeys: ["test-bootstrap-key"]
};

function createDebugTestApp() {
  const logger = new CentralLogger(20);
  const { app } = createApp(testConfig, {
    logger,
    pool: null,
    service: {} as CentralService
  });
  return { app, logger };
}

describe("Central debug log endpoints", () => {
  it("returns the tailed events in chronological order", async () => {
    const { app, logger } = createDebugTestApp();

    logger.logRequest({
      requestId: "req_1",
      method: "GET",
      path: "/api/v1/health",
      status: 200,
      durationMs: 5
    });
    logger.logRequest({
      requestId: "req_2",
      method: "GET",
      path: "/api/v1/threads/thr_118",
      status: 200,
      durationMs: 14,
      authHostId: "mac-local",
      debug: true
    });
    logger.logError({
      event: "http_error",
      error: new Error("boom"),
      requestId: "req_3",
      method: "POST",
      path: "/api/v1/emails/send",
      status: 500,
      authHostId: "mac-mini"
    });

    const response = await app.request("http://localhost/api/v1/debug/logs?tail=2");
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");

    const payload = await response.json();
    expect(payload.events).toHaveLength(2);
    expect(payload.events[0]?.request_id).toBe("req_2");
    expect(payload.events[1]?.request_id).toBe("req_3");
  });

  it("supports error filtering for request and error events", async () => {
    const { app, logger } = createDebugTestApp();

    logger.logRequest({
      requestId: "req_ok",
      method: "GET",
      path: "/api/v1/tasks",
      status: 200,
      durationMs: 9
    });
    logger.logRequest({
      requestId: "req_fail",
      method: "POST",
      path: "/api/v1/emails/send",
      status: 500,
      durationMs: 88,
      authHostId: "mac-local"
    });
    logger.logError({
      event: "http_error",
      error: new Error("invalid payload"),
      requestId: "req_error",
      method: "POST",
      path: "/api/v1/tasks",
      status: 400
    });

    const response = await app.request("http://localhost/api/v1/debug/logs?errors_only=true");
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.events).toHaveLength(2);
    expect(payload.events.every((event: { level: string; status: number | null }) => event.level === "error" || (event.status ?? 0) >= 400)).toBe(true);
  });

  it("streams ready and backlog events over SSE", async () => {
    const { app, logger } = createDebugTestApp();

    logger.logRequest({
      requestId: "req_stream",
      method: "GET",
      path: "/api/v1/threads/thr_118",
      status: 200,
      durationMs: 17,
      authHostId: "mac-local",
      debug: true
    });

    const response = await app.request("http://localhost/api/v1/debug/logs/stream?tail=1");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const decoder = new TextDecoder();
    let text = "";
    for (let index = 0; index < 3; index += 1) {
      const chunk = await reader!.read();
      if (chunk.done) {
        break;
      }
      text += decoder.decode(chunk.value);
      if (text.includes("event: log")) {
        break;
      }
    }

    await reader?.cancel();

    expect(text).toContain("event: ready");
    expect(text).toContain("event: log");
    expect(text).toContain("\"request_id\":\"req_stream\"");
  });
});
